/** Administrator assessments and governance consequences. */

import { withTransaction } from '../../db/tx.js';
import { type PoolClient } from '../../db/pool.js';
import { AppError } from '../../middleware/errors.js';
import { toNotificationItem, type NotificationItem } from '../notifications/service.js';
import { insertNotification } from '../notifications/repo.js';
import { emitNotification } from '../notifications/bus.js';
import { createEventsForAssessment, type AssessmentRecord } from '../../scoring/events.js';
import { supersedeAssessment } from '../../scoring/corrections.js';
import { lockOpenWave } from '../../scoring/waveLock.js';
import { queueGovernanceNotification, type PendingNotification } from './notifications.js';

export interface AdminAssessmentInput {
  verdict: 'real' | 'fake' | 'unverifiable';
  rationale: string;
  detectionResultId?: string;
}

export interface AssessmentResult {
  assessment: AssessmentRecord;
  eventsCreated: { kind: string; count: number }[];
  eventsVoided: number;
  reversalsCreated: number;
}

async function assertDetectionBelongsToPost(
  tx: PoolClient,
  postId: string,
  postRevision: number,
  detectionResultId: string,
): Promise<void> {
  const result = await tx.query<{ post_id: string; post_revision: number }>(
    `SELECT post_id, post_revision FROM detection_results WHERE id = $1`,
    [detectionResultId],
  );
  const detection = result.rows[0];
  if (!detection || detection.post_id !== postId || detection.post_revision !== postRevision) {
    throw new AppError(
      400,
      'INVALID_DETECTION_RESULT',
      'Detection result does not match this post revision',
    );
  }
}

export async function assertNoConflictOfInterest(
  tx: PoolClient,
  postId: string,
  adminId: string,
): Promise<void> {
  const conflict = await tx.query<{ conflict: boolean }>(
    `SELECT (
       EXISTS (SELECT 1 FROM posts WHERE id = $1 AND author_id = $2)
       OR EXISTS (
         SELECT 1 FROM posts r
          WHERE r.reshare_of_post_id = $1 AND r.author_id = $2
       )
       OR EXISTS (SELECT 1 FROM reports WHERE post_id = $1 AND reporter_id = $2)
       OR EXISTS (
          SELECT 1 FROM likes WHERE post_id = $1 AND user_id = $2
       )
     ) AS conflict`,
    [postId, adminId],
  );
  if (conflict.rows[0]?.conflict) {
    throw new AppError(
      403,
      'CONFLICT_OF_INTEREST',
      'Administrator has a conflict of interest for this post',
    );
  }
}

async function notifyAssessment(
  tx: PoolClient,
  postId: string,
  adminId: string,
  verdict: string,
  assessmentId: string,
  previousAssessmentId?: string,
): Promise<{ userId: string; item: NotificationItem }[]> {
  const recipients = await tx.query<{ user_id: string; kind: 'author' | 'reporter' }>(
    `SELECT author_id AS user_id, 'author' AS kind FROM posts WHERE id = $1
     UNION
     SELECT author_id AS user_id, 'author' AS kind FROM posts
       WHERE reshare_of_post_id = $1 AND status <> 'deleted'
     UNION
     SELECT user_id, 'author' AS kind FROM reputation_events
       WHERE post_id = $1 AND kind = 'MISINFO_LIKE' AND assessment_id IN ($2, $3)
     UNION
     SELECT reporter_id AS user_id, 'reporter' AS kind FROM reports WHERE post_id = $1`,
    [postId, assessmentId, previousAssessmentId ?? null],
  );
  const notifications: { userId: string; item: NotificationItem }[] = [];
  for (const recipient of recipients.rows) {
    if (recipient.user_id === adminId) continue;
    const row = await insertNotification(
      {
        userId: recipient.user_id,
        actorId: adminId,
        type: recipient.kind === 'author' ? 'assessment_decided' : 'report_resolved',
        postId,
        payload: { verdict, assessmentId },
      },
      tx,
    );
    notifications.push({ userId: recipient.user_id, item: toNotificationItem(row) });
  }
  return notifications;
}

export async function assessPost(
  postId: string,
  adminId: string,
  input: AdminAssessmentInput,
): Promise<AssessmentResult> {
  const notifications: { userId: string; item: NotificationItem }[] = [];
  const result = await withTransaction((tx) =>
    assessPostInTransaction(tx, postId, adminId, input, notifications),
  );
  for (const notification of notifications)
    emitNotification(notification.userId, notification.item);
  return result;
}

/** Shared transaction boundary for direct assessments and appeal overturns. */
export async function assessPostInTransaction(
  tx: PoolClient,
  postId: string,
  adminId: string,
  input: AdminAssessmentInput,
  notifications: PendingNotification[],
): Promise<AssessmentResult> {
  // Match finalization's wave-first lock order before taking user FK locks.
  await lockOpenWave(tx);
  const postResult = await tx.query<{
    id: string;
    revision: number;
    status: 'published' | 'held' | 'deleted';
    deleted_at: Date | null;
    kind: string;
  }>(`SELECT id, revision, kind, status, deleted_at FROM posts WHERE id = $1 FOR UPDATE`, [postId]);
  const post = postResult.rows[0];
  if (!post) {
    throw new AppError(404, 'NOT_FOUND', 'Post not found');
  }
  if (post.kind !== 'original') {
    throw new AppError(400, 'VALIDATION_ERROR', 'Assess the original post, not its reshare');
  }

  await assertNoConflictOfInterest(tx, postId, adminId);
  if (input.detectionResultId) {
    await assertDetectionBelongsToPost(tx, postId, post.revision, input.detectionResultId);
  }

  const currentResult = await tx.query<AssessmentRecord & { is_current: boolean }>(
    `SELECT id, post_id, post_revision, verdict, source, decided_by, rationale, created_at, is_current
       FROM assessments WHERE post_id = $1 AND is_current FOR UPDATE`,
    [postId],
  );
  const current = currentResult.rows[0];
  if (current && current.source === 'admin' && current.verdict === input.verdict) {
    throw new AppError(409, 'ALREADY_EXISTS', 'The post already has this administrator assessment');
  }

  let assessment: AssessmentRecord;
  let eventsCreated: { kind: string; count: number }[] = [];
  let eventsVoided = 0;
  let reversalsCreated = 0;

  if (current) {
    const openAppeals = await tx.query<{ id: string; appellant_id: string }>(
      `SELECT id, appellant_id FROM appeals WHERE assessment_id = $1 AND status = 'open'`,
      [current.id],
    );
    const result = await supersedeAssessment(tx, current, {
      verdict: input.verdict,
      source: 'admin',
      decided_by: adminId,
      rationale: input.rationale,
      detection_result_id: input.detectionResultId,
      post_revision: post.revision,
    });
    assessment = result.newAssessment;
    eventsCreated = result.eventsCreated;
    eventsVoided = result.voidedCount;
    reversalsCreated = result.reversalsCreated;
    for (const appeal of openAppeals.rows) {
      await queueGovernanceNotification(tx, notifications, {
        userId: appeal.appellant_id,
        actorId: adminId,
        postId,
        type: 'appeal_resolved',
        payload: { appealId: appeal.id, decision: 'overturned', newAssessmentId: assessment.id },
      });
    }
  } else {
    const inserted = await tx.query<AssessmentRecord>(
      `INSERT INTO assessments (
           post_id, post_revision, verdict, source, decided_by, rationale,
           detection_result_id, is_current
         ) VALUES ($1, $2, $3, 'admin', $4, $5, $6, true)
         RETURNING id, post_id, post_revision, verdict, source, decided_by, rationale, created_at`,
      [
        postId,
        post.revision,
        input.verdict,
        adminId,
        input.rationale,
        input.detectionResultId ?? null,
      ],
    );
    const insertedAssessment = inserted.rows[0];
    if (!insertedAssessment) throw new AppError(500, 'INTERNAL', 'Assessment was not created');
    assessment = insertedAssessment;
    const eventResult = await createEventsForAssessment(tx, assessment);
    eventsCreated = eventResult.eventsCreated;
  }

  await tx.query(
    `INSERT INTO admin_audit_log
       (actor_id, actor_kind, action, entity_type, entity_id, before, after)
       VALUES ($1, 'admin', 'assessment.decide', 'assessment', $2, $3, $4)`,
    [
      adminId,
      assessment.id,
      current ? JSON.stringify(current) : null,
      JSON.stringify({ ...assessment, detectionResultId: input.detectionResultId ?? null }),
    ],
  );
  notifications.push(
    ...(await notifyAssessment(tx, postId, adminId, input.verdict, assessment.id, current?.id)),
  );
  return { assessment, eventsCreated, eventsVoided, reversalsCreated };
}
