/** Automatic low-risk assessment job (RUL-014).
 *
 * This job creates only the narrow auto_real assessment and its
 * RESPONSIBLE_POST event. It never creates interaction rewards or penalties.
 */

import { withTransaction } from '../db/tx.js';
import { type PoolClient } from '../db/pool.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { createEventsForAssessment, type AssessmentRecord } from '../scoring/events.js';
import { lockOpenWave } from '../scoring/waveLock.js';

export const AUTO_REAL_LOCK_ID = 42005;
const AUTO_REAL_RATIONALE = 'Automated: low model risk, no reports, review window elapsed.';
let autoRealInterval: NodeJS.Timeout | null = null;

async function runAutoRealTransaction(tx: PoolClient): Promise<number> {
  const lock = await tx.query<{ locked: boolean }>(
    `SELECT pg_try_advisory_xact_lock($1) AS locked`,
    [AUTO_REAL_LOCK_ID],
  );
  if (!lock.rows[0]?.locked) return 0;
  await lockOpenWave(tx);

  const candidates = await tx.query<{
    post_id: string;
    post_revision: number;
    detection_id: string;
  }>(
    `SELECT p.id AS post_id, p.revision AS post_revision, d.id AS detection_id
     FROM posts p
     JOIN post_latest_detection_v d ON d.post_id = p.id
     JOIN users u ON u.id = p.author_id
     WHERE p.kind = 'original' AND p.status = 'published'
       AND u.status = 'active'
       AND d.status = 'ok' AND d.p_fake <= $1
       AND p.created_at <= now() - ($2 || ' minutes')::interval
       AND NOT EXISTS (SELECT 1 FROM assessments a WHERE a.post_id = p.id)
       AND NOT EXISTS (SELECT 1 FROM reports r WHERE r.post_id = p.id)
     ORDER BY p.created_at ASC, p.id ASC
      LIMIT 25
      FOR UPDATE OF p SKIP LOCKED
      FOR SHARE OF u SKIP LOCKED`,
    [config.REAL_THRESHOLD_LOW, String(config.AUTO_REAL_DELAY_MINUTES)],
  );

  let created = 0;
  for (const candidate of candidates.rows) {
    const inserted = await tx.query<AssessmentRecord>(
      `INSERT INTO assessments (
         post_id, post_revision, verdict, source, decided_by, rationale,
         detection_result_id, is_current
       ) VALUES ($1, $2, 'real', 'auto_real', NULL, $3, $4, true)
       ON CONFLICT DO NOTHING
       RETURNING id, post_id, post_revision, verdict, source, decided_by, rationale, created_at`,
      [candidate.post_id, candidate.post_revision, AUTO_REAL_RATIONALE, candidate.detection_id],
    );
    const assessment = inserted.rows[0];
    if (!assessment) continue;

    await createEventsForAssessment(tx, assessment);
    await tx.query(
      `INSERT INTO admin_audit_log (actor_kind, action, entity_type, entity_id, after)
       VALUES ('system', 'assessment.auto_real', 'assessment', $1, $2)`,
      [assessment.id, JSON.stringify({ postId: candidate.post_id, source: 'auto_real' })],
    );
    created += 1;
  }
  return created;
}

export async function runAutoRealOnce(): Promise<number> {
  if (!config.AUTO_REAL_ENABLED) return 0;
  return withTransaction(runAutoRealTransaction);
}

export function startAutoReal(intervalMs = 60_000): void {
  if (autoRealInterval) return;
  autoRealInterval = setInterval(() => {
    void runAutoRealOnce().catch((error) => logger.error({ error }, 'Auto-real job failed'));
  }, intervalMs);
  autoRealInterval.unref();
}

export function stopAutoReal(): void {
  if (!autoRealInterval) return;
  clearInterval(autoRealInterval);
  autoRealInterval = null;
}
