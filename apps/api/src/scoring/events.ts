/**
 * apps/api/src/scoring/events.ts (TASK-021)
 *
 * Reputation event generation and interaction lifecycle rules (RUL-002 to RUL-005,
 * RUL-007, RUL-015, RUL-019, RUL-032).
 */

import { type PoolClient } from '../db/pool.js';
import { config } from '../config.js';
import { lockOpenWave } from './waveLock.js';

export interface AssessmentRecord {
  id: string;
  post_id: string;
  post_revision: number;
  verdict: 'real' | 'fake' | 'unverifiable';
  source: 'admin' | 'auto_real';
  decided_by?: string | null;
  rationale: string;
  created_at?: Date;
}

interface TimeWindow {
  start: Date;
  end: Date;
}

/**
 * Lock and retrieve the currently open wave.
 */
async function getOpenWaveId(tx: PoolClient): Promise<string> {
  return lockOpenWave(tx);
}

/**
 * Check if non-voided count of a positive event kind has reached its per-wave cap.
 */
async function checkEventCap(
  tx: PoolClient,
  waveId: string,
  userId: string,
  kind: 'RESPONSIBLE_POST' | 'RESPONSIBLE_RESHARE' | 'VALID_REPORT',
  maxCap: number,
): Promise<{
  status: 'eligible' | 'voided';
  voidReason: 'cap_exceeded' | null;
  waveId: string | null;
}> {
  // Serialize count-and-insert across different posts for the same user.
  // NO KEY UPDATE remains compatible with foreign-key KEY SHARE locks.
  await tx.query('SELECT id FROM users WHERE id = $1 FOR NO KEY UPDATE', [userId]);
  const countRes = await tx.query<{ count: string }>(
    `SELECT count(*) AS count FROM reputation_events
     WHERE wave_id = $1 AND user_id = $2 AND kind = $3 AND status <> 'voided'`,
    [waveId, userId, kind],
  );
  const count = parseInt(countRes.rows[0]?.count ?? '0', 10);
  if (count >= maxCap) {
    return { status: 'voided', voidReason: 'cap_exceeded', waveId: null };
  }
  return { status: 'eligible', voidReason: null, waveId };
}

/**
 * Compute Good-Faith Windows for a post: periods when an admin assessment with verdict 'real' was current.
 */
async function getGoodFaithWindows(
  tx: PoolClient,
  postId: string,
  currentAssessmentCreatedAt: Date,
): Promise<TimeWindow[]> {
  const res = await tx.query<{
    id: string;
    verdict: string;
    source: string;
    created_at: Date;
    supersedes_id: string | null;
  }>(
    `SELECT id, verdict, source, created_at, supersedes_id
     FROM assessments
     WHERE post_id = $1
     ORDER BY created_at ASC`,
    [postId],
  );

  const windows: TimeWindow[] = [];
  const assessments = res.rows;

  for (let i = 0; i < assessments.length; i++) {
    const a = assessments[i]!;
    if (a.source === 'admin' && a.verdict === 'real') {
      const start = new Date(a.created_at);
      // The window ends when the successor assessment is created
      const successor = assessments.find((s) => s.supersedes_id === a.id);
      const end = successor ? new Date(successor.created_at) : currentAssessmentCreatedAt;
      windows.push({ start, end });
    }
  }

  return windows;
}

function isInGoodFaithWindow(timestamp: Date, windows: TimeWindow[]): boolean {
  const t = timestamp.getTime();
  return windows.some((w) => t >= w.start.getTime() && t <= w.end.getTime());
}

/**
 * Generate events when an assessment is created (RUL-004, RUL-015).
 */
export async function createEventsForAssessment(
  tx: PoolClient,
  assessment: AssessmentRecord,
): Promise<{
  eventsCreated: { kind: string; count: number }[];
  eventsVoided: number;
  reversalsCreated: number;
}> {
  const openWaveId = await getOpenWaveId(tx);

  // Assessments may reward several users. Acquire their cap locks in a stable
  // order before inserting any event to avoid cross-post lock-order cycles.
  await tx.query(
    `SELECT id FROM users WHERE id IN (
       SELECT author_id FROM posts WHERE id = $1 OR reshare_of_post_id = $1
       UNION SELECT reporter_id FROM reports WHERE post_id = $1
     ) ORDER BY id FOR NO KEY UPDATE`,
    [assessment.post_id],
  );

  const postRes = await tx.query<{ id: string; author_id: string }>(
    `SELECT id, author_id FROM posts WHERE id = $1`,
    [assessment.post_id],
  );
  const post = postRes.rows[0];
  /* v8 ignore next 3 */
  if (!post) {
    throw new Error(`Post not found: ${assessment.post_id}`);
  }

  const assessmentCreatedAt = assessment.created_at ?? new Date();
  const counts: Record<string, number> = {};
  function inc(kind: string): void {
    counts[kind] = (counts[kind] ?? 0) + 1;
  }

  if (assessment.verdict === 'real') {
    // 1. Author receives RESPONSIBLE_POST (+1)
    const cap = await checkEventCap(
      tx,
      openWaveId,
      post.author_id,
      'RESPONSIBLE_POST',
      config.MAX_RESPONSIBLE_POST_EVENTS_PER_WAVE,
    );
    await tx.query(
      `INSERT INTO reputation_events (
        user_id, post_id, assessment_id, kind, value, status, void_reason, wave_id
      ) VALUES ($1, $2, $3, 'RESPONSIBLE_POST', 1, $4, $5, $6)
      ON CONFLICT (assessment_id, user_id, kind) WHERE kind <> 'REVERSAL' DO NOTHING`,
      [post.author_id, post.id, assessment.id, cap.status, cap.voidReason, cap.waveId],
    );
    inc('RESPONSIBLE_POST');

    // 2. If admin real, reward non-deleted resharers (author_id <> post.author_id)
    if (assessment.source === 'admin' && config.RESPONSIBLE_RESHARE_REWARD_ENABLED) {
      const reshares = await tx.query<{ id: string; author_id: string }>(
        `SELECT id, author_id FROM posts
         WHERE reshare_of_post_id = $1 AND kind = 'reshare' AND status <> 'deleted' AND author_id <> $2
         ORDER BY created_at ASC, id ASC`,
        [post.id, post.author_id],
      );

      for (const r of reshares.rows) {
        const rCap = await checkEventCap(
          tx,
          openWaveId,
          r.author_id,
          'RESPONSIBLE_RESHARE',
          config.MAX_RESPONSIBLE_RESHARE_EVENTS_PER_WAVE,
        );
        await tx.query(
          `INSERT INTO reputation_events (
            user_id, post_id, assessment_id, reshare_post_id, kind, value, status, void_reason, wave_id
          ) VALUES ($1, $2, $3, $4, 'RESPONSIBLE_RESHARE', 1, $5, $6, $7)
          ON CONFLICT (assessment_id, user_id, kind) WHERE kind <> 'REVERSAL' DO NOTHING`,
          [r.author_id, post.id, assessment.id, r.id, rCap.status, rCap.voidReason, rCap.waveId],
        );
        inc('RESPONSIBLE_RESHARE');
      }
    }

    // Resolve open reports if admin
    if (assessment.source === 'admin') {
      await tx.query(
        `UPDATE reports SET status = 'resolved' WHERE post_id = $1 AND status = 'open'`,
        [post.id],
      );
    }
  } else if (assessment.verdict === 'fake') {
    // 1. Author receives flat MISINFO_POST (-1) (DEC-004, no cap)
    await tx.query(
      `INSERT INTO reputation_events (
        user_id, post_id, assessment_id, kind, value, status, wave_id
      ) VALUES ($1, $2, $3, 'MISINFO_POST', -1, 'eligible', $4)
      ON CONFLICT (assessment_id, user_id, kind) WHERE kind <> 'REVERSAL' DO NOTHING`,
      [post.author_id, post.id, assessment.id, openWaveId],
    );
    inc('MISINFO_POST');

    const windows = await getGoodFaithWindows(tx, post.id, assessmentCreatedAt);

    // 2. Resharers receive MISINFO_RESHARE (-1) unless protected by Good-Faith Window
    if (config.RESHARE_PENALTY_ENABLED) {
      const reshares = await tx.query<{ id: string; author_id: string; created_at: Date }>(
        `SELECT id, author_id, created_at FROM posts
         WHERE reshare_of_post_id = $1 AND kind = 'reshare' AND status <> 'deleted' AND author_id <> $2
         ORDER BY created_at ASC, id ASC`,
        [post.id, post.author_id],
      );

      for (const r of reshares.rows) {
        if (!isInGoodFaithWindow(new Date(r.created_at), windows)) {
          await tx.query(
            `INSERT INTO reputation_events (
              user_id, post_id, assessment_id, reshare_post_id, kind, value, status, wave_id
            ) VALUES ($1, $2, $3, $4, 'MISINFO_RESHARE', -1, 'eligible', $5)
            ON CONFLICT (assessment_id, user_id, kind) WHERE kind <> 'REVERSAL' DO NOTHING`,
            [r.author_id, post.id, assessment.id, r.id, openWaveId],
          );
          inc('MISINFO_RESHARE');
        }
      }
    }

    // 3. Likers receive MISINFO_LIKE (-1) unless protected by Good-Faith Window
    if (config.LIKE_PENALTY_ENABLED) {
      const likes = await tx.query<{ user_id: string; updated_at: Date }>(
        `SELECT user_id, updated_at FROM likes
         WHERE post_id = $1 AND deleted_at IS NULL AND user_id <> $2`,
        [post.id, post.author_id],
      );

      for (const l of likes.rows) {
        if (!isInGoodFaithWindow(new Date(l.updated_at), windows)) {
          await tx.query(
            `INSERT INTO reputation_events (
              user_id, post_id, assessment_id, kind, value, status, wave_id
            ) VALUES ($1, $2, $3, 'MISINFO_LIKE', -1, 'eligible', $4)
            ON CONFLICT (assessment_id, user_id, kind) WHERE kind <> 'REVERSAL' DO NOTHING`,
            [l.user_id, post.id, assessment.id, openWaveId],
          );
          inc('MISINFO_LIKE');
        }
      }
    }

    // 4. Reporters receive VALID_REPORT (+1) (historical lookup per Audit Gap 5)
    const reports = await tx.query<{ id: string; reporter_id: string }>(
      `SELECT id, reporter_id FROM reports
       WHERE post_id = $1 AND reporter_id <> $2
         AND created_at <= (SELECT created_at FROM assessments WHERE id = $3)
       ORDER BY created_at ASC`,
      [post.id, post.author_id, assessment.id],
    );

    for (const rep of reports.rows) {
      // Check if reporter already holds a non-voided, non-reversed VALID_REPORT on this post
      const existing = await tx.query<{ id: string }>(
        `SELECT id FROM reputation_events
         WHERE post_id = $1 AND user_id = $2 AND kind = 'VALID_REPORT' AND status <> 'voided'
           AND id NOT IN (SELECT reverses_event_id FROM reputation_events WHERE kind = 'REVERSAL' AND status <> 'voided')`,
        [post.id, rep.reporter_id],
      );

      if (existing.rows.length === 0) {
        const repCap = await checkEventCap(
          tx,
          openWaveId,
          rep.reporter_id,
          'VALID_REPORT',
          config.MAX_VALID_REPORT_EVENTS_PER_WAVE,
        );
        await tx.query(
          `INSERT INTO reputation_events (
            user_id, post_id, assessment_id, report_id, kind, value, status, void_reason, wave_id
          ) VALUES ($1, $2, $3, $4, 'VALID_REPORT', 1, $5, $6, $7)
          ON CONFLICT (assessment_id, user_id, kind) WHERE kind <> 'REVERSAL' DO NOTHING`,
          [
            rep.reporter_id,
            post.id,
            assessment.id,
            rep.id,
            repCap.status,
            repCap.voidReason,
            repCap.waveId,
          ],
        );
        inc('VALID_REPORT');
      }
    }

    // Resolve open reports
    await tx.query(
      `UPDATE reports SET status = 'resolved' WHERE post_id = $1 AND status = 'open'`,
      [post.id],
    );
  } else if (assessment.verdict === 'unverifiable') {
    // Resolve open reports without scoring events
    await tx.query(
      `UPDATE reports SET status = 'resolved' WHERE post_id = $1 AND status = 'open'`,
      [post.id],
    );
  }

  const eventsCreated = Object.entries(counts).map(([kind, count]) => ({ kind, count }));
  return { eventsCreated, eventsVoided: 0, reversalsCreated: 0 };
}

/**
 * Sync reshare reputation event on reshare creation (RUL-004, RUL-019).
 */
export async function syncReshareEventOnCreate(
  tx: PoolClient,
  resharePost: { id: string; author_id: string; reshare_of_post_id: string },
): Promise<void> {
  const currentAssess = await tx.query<{
    id: string;
    verdict: 'real' | 'fake' | 'unverifiable';
    source: string;
    post_id: string;
  }>(
    `SELECT a.id, a.verdict, a.source, a.post_id
     FROM assessments a
     WHERE a.post_id = $1 AND a.is_current`,
    [resharePost.reshare_of_post_id],
  );

  const assess = currentAssess.rows[0];
  if (!assess || assess.source !== 'admin') {
    return;
  }

  const origPostRes = await tx.query<{ author_id: string }>(
    `SELECT author_id FROM posts WHERE id = $1`,
    [resharePost.reshare_of_post_id],
  );
  const origAuthorId = origPostRes.rows[0]?.author_id;
  /* v8 ignore next 3 */
  if (!origAuthorId) {
    return;
  }
  if (origAuthorId === resharePost.author_id) {
    return;
  }

  const openWaveId = await getOpenWaveId(tx);

  if (assess.verdict === 'fake' && config.RESHARE_PENALTY_ENABLED) {
    // Check existing event for (assess.id, user, 'MISINFO_RESHARE')
    const existing = await tx.query<{ id: string; status: string; void_reason: string | null }>(
      `SELECT id, status, void_reason FROM reputation_events
       WHERE assessment_id = $1 AND user_id = $2 AND kind = 'MISINFO_RESHARE'`,
      [assess.id, resharePost.author_id],
    );

    const row = existing.rows[0];
    if (row && row.status === 'voided' && row.void_reason === 'interaction_retracted') {
      // Reactivate
      await tx.query(
        `UPDATE reputation_events
         SET status = 'eligible', void_reason = NULL, wave_id = $1, reshare_post_id = $2
         WHERE id = $3`,
        [openWaveId, resharePost.id, row.id],
      );
    } else if (!row) {
      await tx.query(
        `INSERT INTO reputation_events (
          user_id, post_id, assessment_id, reshare_post_id, kind, value, status, wave_id
        ) VALUES ($1, $2, $3, $4, 'MISINFO_RESHARE', -1, 'eligible', $5)
        ON CONFLICT (assessment_id, user_id, kind) WHERE kind <> 'REVERSAL' DO NOTHING`,
        [resharePost.author_id, assess.post_id, assess.id, resharePost.id, openWaveId],
      );
    }
  } else if (assess.verdict === 'real' && config.RESPONSIBLE_RESHARE_REWARD_ENABLED) {
    const rCap = await checkEventCap(
      tx,
      openWaveId,
      resharePost.author_id,
      'RESPONSIBLE_RESHARE',
      config.MAX_RESPONSIBLE_RESHARE_EVENTS_PER_WAVE,
    );

    const existing = await tx.query<{ id: string; status: string; void_reason: string | null }>(
      `SELECT id, status, void_reason FROM reputation_events
       WHERE assessment_id = $1 AND user_id = $2 AND kind = 'RESPONSIBLE_RESHARE'`,
      [assess.id, resharePost.author_id],
    );

    const row = existing.rows[0];
    if (row && row.status === 'voided' && row.void_reason === 'interaction_retracted') {
      await tx.query(
        `UPDATE reputation_events
         SET status = $1, void_reason = $2, wave_id = $3, reshare_post_id = $4
         WHERE id = $5`,
        [rCap.status, rCap.voidReason, rCap.waveId, resharePost.id, row.id],
      );
    } else if (!row) {
      await tx.query(
        `INSERT INTO reputation_events (
          user_id, post_id, assessment_id, reshare_post_id, kind, value, status, void_reason, wave_id
        ) VALUES ($1, $2, $3, $4, 'RESPONSIBLE_RESHARE', 1, $5, $6, $7)
        ON CONFLICT (assessment_id, user_id, kind) WHERE kind <> 'REVERSAL' DO NOTHING`,
        [
          resharePost.author_id,
          assess.post_id,
          assess.id,
          resharePost.id,
          rCap.status,
          rCap.voidReason,
          rCap.waveId,
        ],
      );
    }
  }
}

/**
 * Retract reshare reputation event on reshare delete (RUL-019, DEC-005).
 */
export async function retractReshareEventOnDelete(
  tx: PoolClient,
  userId: string,
  originalPostId: string,
): Promise<void> {
  // Lock the open wave first so a concurrent finalization has either
  // committed (the event is now counted and stays untouched) or waits.
  await getOpenWaveId(tx);

  const events = await tx.query<{ id: string; status: string }>(
    `SELECT id, status FROM reputation_events
     WHERE user_id = $1 AND post_id = $2 AND kind IN ('MISINFO_RESHARE', 'RESPONSIBLE_RESHARE')
       AND status IN ('eligible', 'held')
     FOR UPDATE`,
    [userId, originalPostId],
  );

  for (const e of events.rows) {
    const voided = await tx.query(
      `UPDATE reputation_events
       SET status = 'voided', void_reason = 'interaction_retracted', wave_id = NULL
       WHERE id = $1 AND status IN ('eligible', 'held')`,
      [e.id],
    );
    if ((voided.rowCount ?? 0) === 0) continue; // counted meanwhile: immutable (RUL-019)

    await tx.query(
      `UPDATE appeals
       SET status = 'overturned', resolved_by_system = true, resolved_at = now(),
           resolution_note = 'Closed automatically: reshare retracted before wave finalization'
       WHERE event_id = $1 AND status = 'open'`,
      [e.id],
    );
  }
}

/**
 * Sync like reputation event on like creation (RUL-032, DEC-001).
 */
export async function syncLikeEventOnLike(
  tx: PoolClient,
  userId: string,
  originalPostId: string,
): Promise<void> {
  if (!config.LIKE_PENALTY_ENABLED) {
    return;
  }

  const currentAssess = await tx.query<{
    id: string;
    verdict: string;
    source: string;
    author_id: string;
  }>(
    `SELECT a.id, a.verdict, a.source, p.author_id
     FROM assessments a
     JOIN posts p ON p.id = a.post_id
     WHERE a.post_id = $1 AND a.is_current`,
    [originalPostId],
  );

  const assess = currentAssess.rows[0];
  if (
    !assess ||
    assess.source !== 'admin' ||
    assess.verdict !== 'fake' ||
    assess.author_id === userId
  ) {
    return;
  }

  const openWaveId = await getOpenWaveId(tx);

  const existing = await tx.query<{ id: string; status: string; void_reason: string | null }>(
    `SELECT id, status, void_reason FROM reputation_events
     WHERE assessment_id = $1 AND user_id = $2 AND kind = 'MISINFO_LIKE'`,
    [assess.id, userId],
  );

  const row = existing.rows[0];
  if (row && row.status === 'voided' && row.void_reason === 'interaction_retracted') {
    await tx.query(
      `UPDATE reputation_events
       SET status = 'eligible', void_reason = NULL, wave_id = $1
       WHERE id = $2`,
      [openWaveId, row.id],
    );
  } else if (!row) {
    await tx.query(
      `INSERT INTO reputation_events (
        user_id, post_id, assessment_id, kind, value, status, wave_id
      ) VALUES ($1, $2, $3, 'MISINFO_LIKE', -1, 'eligible', $4)
      ON CONFLICT (assessment_id, user_id, kind) WHERE kind <> 'REVERSAL' DO NOTHING`,
      [userId, originalPostId, assess.id, openWaveId],
    );
  }
}

/**
 * Retract like reputation event on unlike (RUL-032, DEC-001, DEC-005).
 */
export async function retractLikeEventOnUnlike(
  tx: PoolClient,
  userId: string,
  originalPostId: string,
): Promise<void> {
  // Lock the open wave first so a concurrent finalization has either
  // committed (the event is now counted and stays untouched) or waits.
  await getOpenWaveId(tx);

  const events = await tx.query<{ id: string }>(
    `SELECT id FROM reputation_events
     WHERE user_id = $1 AND post_id = $2 AND kind = 'MISINFO_LIKE' AND status IN ('eligible', 'held')
     FOR UPDATE`,
    [userId, originalPostId],
  );

  for (const e of events.rows) {
    const voided = await tx.query(
      `UPDATE reputation_events
       SET status = 'voided', void_reason = 'interaction_retracted', wave_id = NULL
       WHERE id = $1 AND status IN ('eligible', 'held')`,
      [e.id],
    );
    if ((voided.rowCount ?? 0) === 0) continue; // counted meanwhile: immutable (RUL-032)

    await tx.query(
      `UPDATE appeals
       SET status = 'overturned', resolved_by_system = true, resolved_at = now(),
           resolution_note = 'Closed automatically: like retracted before wave finalization'
       WHERE event_id = $1 AND status = 'open'`,
      [e.id],
    );
  }
}
