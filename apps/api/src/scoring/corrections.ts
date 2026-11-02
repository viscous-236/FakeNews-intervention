/**
 * apps/api/src/scoring/corrections.ts (TASK-024)
 *
 * Implements assessment superseding and correction cascade (RUL-015).
 * Marks old assessment as not current, inserts successor assessment,
 * voids eligible/held events with reason 'assessment_superseded',
 * auto-closes open appeals on them, creates REVERSAL events for counted events,
 * and calls createEventsForAssessment for the new assessment.
 */

import { type PoolClient } from '../db/pool.js';
import { AppError } from '../middleware/appError.js';
import { createEventsForAssessment, type AssessmentRecord } from './events.js';

export interface OldAssessmentParam {
  id: string;
  post_id?: string;
  post_revision?: number;
}

export interface NewAssessmentInput {
  verdict: 'real' | 'fake' | 'unverifiable';
  source: 'admin' | 'auto_real';
  decided_by?: string | null;
  rationale: string;
  detection_result_id?: string | null;
  post_revision?: number;
}

export interface SupersedeResult {
  newAssessment: AssessmentRecord;
  eventsCreated: { kind: string; count: number }[];
  voidedCount: number;
  reversalsCreated: number;
}

/**
 * Lock and retrieve the currently open wave id.
 */
async function getOpenWaveId(tx: PoolClient): Promise<string> {
  const res = await tx.query<{ id: string }>(
    `SELECT id FROM waves WHERE status = 'open' FOR SHARE`,
  );
  const row = res.rows[0];
  /* v8 ignore next 3 */
  if (!row) {
    throw new AppError(500, 'INTERNAL', 'No open wave found');
  }
  return row.id;
}

/**
 * Supersede an existing assessment with a new verdict and rationale (RUL-015).
 */
export async function supersedeAssessment(
  tx: PoolClient,
  oldAssessment: OldAssessmentParam,
  input: NewAssessmentInput,
): Promise<SupersedeResult> {
  // 1. Fetch and lock the old assessment
  const oldRes = await tx.query<{
    id: string;
    post_id: string;
    post_revision: number;
    verdict: string;
    source: string;
    is_current: boolean;
  }>(
    `SELECT id, post_id, post_revision, verdict, source, is_current
     FROM assessments
     WHERE id = $1
     FOR UPDATE`,
    [oldAssessment.id],
  );

  const old = oldRes.rows[0];
  if (!old) {
    throw new AppError(404, 'NOT_FOUND', 'Old assessment not found');
  }

  if (!old.is_current) {
    throw new AppError(409, 'CONFLICT', 'Assessment is already superseded');
  }

  const postId = old.post_id;
  const postRevision = input.post_revision ?? old.post_revision;

  // 2. Set old assessment is_current = false
  await tx.query(
    `UPDATE assessments
     SET is_current = false
     WHERE id = $1`,
    [old.id],
  );

  // 3. Insert successor assessment
  const insertRes = await tx.query<AssessmentRecord>(
    `INSERT INTO assessments (
       post_id,
       post_revision,
       verdict,
       source,
       decided_by,
       rationale,
       detection_result_id,
       supersedes_id,
       is_current
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
     RETURNING id, post_id, post_revision, verdict, source, decided_by, rationale, created_at`,
    [
      postId,
      postRevision,
      input.verdict,
      input.source,
      input.decided_by ?? null,
      input.rationale,
      input.detection_result_id ?? null,
      old.id,
    ],
  );

  const newAssessment = insertRes.rows[0];
  /* v8 ignore next 3 */
  if (!newAssessment) {
    throw new AppError(500, 'INTERNAL', 'Failed to insert successor assessment');
  }

  // 4. Note: post label is computed dynamically by post_public_status_v view

  // 5. Cascade across events attached to the old assessment
  const oldEventsRes = await tx.query<{
    id: string;
    user_id: string;
    post_id: string;
    kind: string;
    value: number;
    status: 'eligible' | 'held' | 'voided' | 'counted';
    wave_id: string | null;
  }>(
    `SELECT id, user_id, post_id, kind, value, status, wave_id
     FROM reputation_events
     WHERE assessment_id = $1`,
    [old.id],
  );

  let voidedCount = 0;
  let reversalsCreated = 0;
  const openWaveId = await getOpenWaveId(tx);

  for (const ev of oldEventsRes.rows) {
    if (ev.status === 'eligible' || ev.status === 'held') {
      // Void the event
      await tx.query(
        `UPDATE reputation_events
         SET status = 'voided', void_reason = 'assessment_superseded', wave_id = NULL
         WHERE id = $1`,
        [ev.id],
      );
      voidedCount++;

      // Close open appeal if present
      await tx.query(
        `UPDATE appeals
         SET status = 'overturned',
             resolved_by_system = true,
             resolved_at = now(),
             resolution_note = 'Superseded by new assessment',
             new_assessment_id = $2
         WHERE event_id = $1 AND status = 'open'`,
        [ev.id, newAssessment.id],
      );
    } else if (ev.status === 'counted') {
      // Reversal event for counted events: opposite value
      const reversalValue = -ev.value; // +1 becomes -1, -1 becomes +1
      await tx.query(
        `INSERT INTO reputation_events (
           user_id, post_id, assessment_id, kind, value, status, wave_id, reverses_event_id
         ) VALUES ($1, $2, $3, 'REVERSAL', $4, 'eligible', $5, $6)
         ON CONFLICT (reverses_event_id) WHERE kind = 'REVERSAL' AND status <> 'voided' DO NOTHING`,
        [
          ev.user_id,
          ev.post_id,
          newAssessment.id,
          reversalValue,
          openWaveId,
          ev.id,
        ],
      );
      reversalsCreated++;

      // Close any open appeal on counted event
      await tx.query(
        `UPDATE appeals
         SET status = 'overturned',
             resolved_by_system = true,
             resolved_at = now(),
             resolution_note = 'Superseded by new assessment',
             new_assessment_id = $2
         WHERE event_id = $1 AND status = 'open'`,
        [ev.id, newAssessment.id],
      );
    }
  }

  // 6. Create new events for the successor assessment
  const eventResult = await createEventsForAssessment(tx, newAssessment);

  return {
    newAssessment,
    eventsCreated: eventResult.eventsCreated,
    voidedCount,
    reversalsCreated,
  };
}
