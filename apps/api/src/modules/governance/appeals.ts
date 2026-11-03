/** Appeal ownership, lifecycle, and administrator resolution (RUL-008, RUL-016). */
import { type ResolveAppealInput, type ListAdminAppealsQuery } from '@app/shared';
import { config } from '../../config.js';
import { getPool } from '../../db/pool.js';
import { withTransaction } from '../../db/tx.js';
import { decodeCursor, encodeCursor } from '../../db/cursor.js';
import { AppError } from '../../middleware/errors.js';
import { lockOpenWave } from '../../scoring/waveLock.js';
import { findEventByIdAndUser, insertAppeal, type AppealRow } from '../score/repo.js';
import { assessPostInTransaction, assertNoConflictOfInterest } from './assessments.js';
import {
  queueGovernanceNotification,
  publishGovernanceNotifications,
  type PendingNotification,
} from './notifications.js';

export async function appealEvent(
  userId: string,
  eventId: string,
  input: { reason: string },
): Promise<{ id: string; status: 'open' }> {
  const pending: PendingNotification[] = [];
  const result = await withTransaction(async (tx) => {
    await lockOpenWave(tx);
    const target = await tx.query<{ post_id: string }>(
      'SELECT post_id FROM reputation_events WHERE id = $1 AND user_id = $2',
      [eventId, userId],
    );
    if (!target.rows[0]) throw new AppError(404, 'NOT_FOUND', 'Event not found');
    // Serialize with assessments, other appeals, and interactions on this post.
    await tx.query('SELECT id FROM posts WHERE id = $1 FOR UPDATE', [target.rows[0].post_id]);
    const event = await findEventByIdAndUser(eventId, userId, tx);
    if (!event) throw new AppError(404, 'NOT_FOUND', 'Event not found');
    if (!['MISINFO_POST', 'MISINFO_RESHARE', 'MISINFO_LIKE'].includes(event.kind)) {
      throw new AppError(400, 'INVALID_APPEAL', 'Only negative reputation events can be appealed');
    }
    if (event.has_appeal)
      throw new AppError(409, 'ALREADY_EXISTS', 'An appeal already exists for this event');
    if (event.status === 'voided')
      throw new AppError(400, 'INVALID_APPEAL', 'Cannot appeal a voided event');
    const expiresAt = event.assessment_created_at.getTime() + config.APPEAL_WINDOW_DAYS * 86400000;
    if (Date.now() > expiresAt)
      throw new AppError(409, 'APPEAL_WINDOW_EXPIRED', 'Appeal window has expired');
    const appeal = await insertAppeal(
      { eventId, assessmentId: event.assessment_id, appellantId: userId, reason: input.reason },
      tx,
    );
    const admins = await tx.query<{ id: string }>(
      `SELECT id FROM users WHERE role = 'admin' AND status = 'active' AND email_verified_at IS NOT NULL`,
    );
    for (const admin of admins.rows) {
      await queueGovernanceNotification(tx, pending, {
        userId: admin.id,
        actorId: userId,
        postId: event.post_id,
        type: 'appeal_opened',
        payload: { appealId: appeal.id, eventId },
      });
    }
    return { id: appeal.id, status: 'open' as const };
  });
  publishGovernanceNotifications(pending);
  return result;
}

export async function listAdminAppeals(query: ListAdminAppealsQuery) {
  const cursor = query.cursor ? decodeCursor(query.cursor) : null;
  const result = await getPool().query<AppealRow & { new_assessment_id: string | null }>(
    `SELECT * FROM appeals
     WHERE ($1::text IS NULL OR status = $1)
       AND ($2::timestamptz IS NULL OR (date_trunc('milliseconds', created_at), id) < ($2, $3::uuid))
     ORDER BY date_trunc('milliseconds', created_at) DESC, id DESC LIMIT $4`,
    [query.status ?? null, cursor?.createdAt ?? null, cursor?.id ?? null, query.limit + 1],
  );
  const rows = result.rows.slice(0, query.limit);
  const last = rows.at(-1);
  return {
    items: rows.map((row) => ({
      id: row.id,
      eventId: row.event_id,
      assessmentId: row.assessment_id,
      appellantId: row.appellant_id,
      reason: row.reason,
      status: row.status,
      resolutionNote: row.resolution_note,
      newAssessmentId: row.new_assessment_id,
      createdAt: row.created_at.toISOString(),
      resolvedAt: row.resolved_at?.toISOString() ?? null,
    })),
    nextCursor:
      result.rows.length > query.limit && last ? encodeCursor(last.created_at, last.id) : null,
  };
}

export async function resolveAppeal(appealId: string, adminId: string, input: ResolveAppealInput) {
  const pending: PendingNotification[] = [];
  const result = await withTransaction(async (tx) => {
    const waveId = await lockOpenWave(tx);
    const target = await tx.query<{ post_id: string }>(
      `SELECT e.post_id FROM appeals a JOIN reputation_events e ON e.id = a.event_id WHERE a.id = $1`,
      [appealId],
    );
    const postId = target.rows[0]?.post_id;
    if (!postId) throw new AppError(404, 'NOT_FOUND', 'Appeal not found');
    await tx.query('SELECT id FROM posts WHERE id = $1 FOR UPDATE', [postId]);
    await assertNoConflictOfInterest(tx, postId, adminId);
    const appeals = await tx.query<AppealRow & { event_status: string; is_current: boolean }>(
      `SELECT a.*, e.status AS event_status, s.is_current
       FROM appeals a JOIN reputation_events e ON e.id = a.event_id
       JOIN assessments s ON s.id = a.assessment_id WHERE a.id = $1 FOR UPDATE OF a, e`,
      [appealId],
    );
    const appeal = appeals.rows[0]!;
    if (appeal.status !== 'open')
      throw new AppError(409, 'ALREADY_EXISTS', 'Appeal is already resolved');
    if (!appeal.is_current || appeal.event_status === 'voided') {
      throw new AppError(409, 'CONFLICT', 'The appealed assessment is no longer actionable');
    }
    // Resolve this appeal before the supersede cascade auto-closes its peers.
    // All changes roll back together if the assessment fails.
    await tx.query(
      `UPDATE appeals SET status = $2, resolved_by = $3, resolved_by_system = false,
       resolved_at = now(), resolution_note = $4 WHERE id = $1`,
      [appealId, input.decision, adminId, input.note],
    );
    let newAssessmentId: string | null = null;
    if (input.decision === 'upheld') {
      await tx.query(
        `UPDATE reputation_events SET status = 'eligible', wave_id = $2 WHERE id = $1 AND status = 'held'`,
        [appeal.event_id, waveId],
      );
    } else {
      const assessment = await assessPostInTransaction(
        tx,
        postId,
        adminId,
        { verdict: input.newVerdict, rationale: input.rationale },
        pending,
      );
      newAssessmentId = assessment.assessment.id;
      await tx.query('UPDATE appeals SET new_assessment_id = $2 WHERE id = $1', [
        appealId,
        newAssessmentId,
      ]);
    }
    await tx.query(
      `INSERT INTO admin_audit_log (actor_id, actor_kind, action, entity_type, entity_id, before, after)
       VALUES ($1, 'admin', 'appeal.resolve', 'appeal', $2, $3, $4)`,
      [
        adminId,
        appealId,
        JSON.stringify({ status: 'open', eventStatus: appeal.event_status }),
        JSON.stringify({ status: input.decision, note: input.note, newAssessmentId }),
      ],
    );
    await queueGovernanceNotification(tx, pending, {
      userId: appeal.appellant_id,
      actorId: adminId,
      postId,
      type: 'appeal_resolved',
      payload: { appealId, decision: input.decision, newAssessmentId },
    });
    return { id: appealId, status: input.decision, newAssessmentId };
  });
  publishGovernanceNotifications(pending);
  return result;
}
