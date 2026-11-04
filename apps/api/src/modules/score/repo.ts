/**
 * apps/api/src/modules/score/repo.ts (TASK-045, Section 1.7, RUL-016, RUL-023)
 *
 * Repository for score, ledger history, reputation events, appeals, and wave information.
 */

import { type PoolClient } from '../../db/pool.js';
import { getPool } from '../../db/pool.js';
import { type DecodedCursor } from '../../db/cursor.js';

export interface CurrentWaveRow {
  id: string;
  number: number;
  opened_at: Date;
}

export interface ScoreAggregateRow {
  n_pos: string;
  n_neg: string;
  n_adj: string;
}

export interface LedgerJoinedRow {
  wave_id: string;
  wave_number: number;
  n_pos: number;
  n_neg: number;
  n_adj: number;
  r: number;
  sigma_used: string;
  q_before: string;
  delta: string;
  q_after: string;
  formula_version: string;
  created_at: Date;
  finalized_at: Date | null;
}

export interface EventJoinedRow {
  id: string;
  kind: string;
  value: number;
  status: string;
  wave_number: number | null;
  void_reason: string | null;
  post_id: string;
  post_body: string;
  assessment_id: string | null;
  assessment_verdict: string | null;
  assessment_source: string | null;
  assessment_created_at: Date | null;
  assessment_rationale: string | null;
  reverses_event_id: string | null;
  appeal_id: string | null;
  appeal_status: string | null;
  created_at: Date;
}

export interface AppealRow {
  id: string;
  event_id: string;
  assessment_id: string;
  appellant_id: string;
  reason: string;
  status: 'open' | 'upheld' | 'overturned';
  resolution_note: string | null;
  created_at: Date;
  resolved_at: Date | null;
}

export async function getCurrentOpenWave(client?: PoolClient): Promise<CurrentWaveRow | null> {
  const executor = client ?? getPool();
  const res = await executor.query<CurrentWaveRow>(
    `SELECT id, number, opened_at FROM waves WHERE status = 'open' LIMIT 1`,
  );
  return res.rows[0] ?? null;
}

export async function getPendingAggregateForUser(
  userId: string,
  waveId: string,
  client?: PoolClient,
): Promise<{ nPos: number; nNeg: number; nAdj: number }> {
  const executor = client ?? getPool();
  const res = await executor.query<ScoreAggregateRow>(
    `SELECT
       count(*) FILTER (WHERE kind IN ('RESPONSIBLE_POST','RESPONSIBLE_RESHARE','VALID_REPORT')) AS n_pos,
       count(*) FILTER (WHERE kind IN ('MISINFO_POST','MISINFO_RESHARE','MISINFO_LIKE')) AS n_neg,
       COALESCE(sum(value) FILTER (WHERE kind = 'REVERSAL'), 0) AS n_adj
     FROM reputation_events
     WHERE user_id = $1 AND wave_id = $2 AND status = 'eligible'`,
    [userId, waveId],
  );

  const row = res.rows[0];
  return {
    nPos: parseInt(row?.n_pos ?? '0', 10),
    nNeg: parseInt(row?.n_neg ?? '0', 10),
    nAdj: parseInt(row?.n_adj ?? '0', 10),
  };
}

export async function findUserLedgerHistory(
  userId: string,
  options: {
    cursor?: DecodedCursor | null;
    limit: number;
  },
  client?: PoolClient,
): Promise<LedgerJoinedRow[]> {
  const executor = client ?? getPool();
  const limitPlusOne = options.limit + 1;

  const cursorCreatedAt = options.cursor ? options.cursor.createdAt : null;
  const cursorId = options.cursor ? options.cursor.id : null;

  const res = await executor.query<LedgerJoinedRow>(
    `SELECT
       uwr.wave_id,
       w.number AS wave_number,
       uwr.n_pos,
       uwr.n_neg,
       uwr.n_adj,
       uwr.r,
       uwr.sigma_used::text,
       uwr.q_before::text,
       uwr.delta::text,
       uwr.q_after::text,
       uwr.formula_version,
       uwr.created_at,
       w.finalized_at
     FROM user_wave_reputation uwr
     JOIN waves w ON w.id = uwr.wave_id
     WHERE uwr.user_id = $1
       AND (
         $2::timestamptz IS NULL
         OR (uwr.created_at, uwr.wave_id) < ($2, $3::uuid)
       )
     ORDER BY uwr.created_at DESC, uwr.wave_id DESC
     LIMIT $4`,
    [userId, cursorCreatedAt, cursorId, limitPlusOne],
  );

  return res.rows;
}

export async function findUserLedgerByWaveNumber(
  userId: string,
  waveNumber: number,
  client?: PoolClient,
): Promise<LedgerJoinedRow | null> {
  const executor = client ?? getPool();
  const res = await executor.query<LedgerJoinedRow>(
    `SELECT
       uwr.wave_id,
       w.number AS wave_number,
       uwr.n_pos,
       uwr.n_neg,
       uwr.n_adj,
       uwr.r,
       uwr.sigma_used::text,
       uwr.q_before::text,
       uwr.delta::text,
       uwr.q_after::text,
       uwr.formula_version,
       uwr.created_at,
       w.finalized_at
     FROM user_wave_reputation uwr
     JOIN waves w ON w.id = uwr.wave_id
     WHERE uwr.user_id = $1 AND w.number = $2`,
    [userId, waveNumber],
  );

  return res.rows[0] ?? null;
}

export async function findEventsForWaveAndUser(
  userId: string,
  waveId: string,
  client?: PoolClient,
): Promise<EventJoinedRow[]> {
  const executor = client ?? getPool();
  const res = await executor.query<EventJoinedRow>(
    `SELECT
       e.id,
       e.kind,
       e.value,
       e.status,
       w.number AS wave_number,
       e.void_reason,
       e.post_id,
       p.body AS post_body,
       e.assessment_id,
       a.verdict AS assessment_verdict,
       a.source AS assessment_source,
       a.created_at AS assessment_created_at,
       a.rationale AS assessment_rationale,
       e.reverses_event_id,
       ap.id AS appeal_id,
       ap.status AS appeal_status,
       e.created_at
     FROM reputation_events e
     LEFT JOIN waves w ON w.id = e.wave_id
     JOIN posts p ON p.id = e.post_id
     LEFT JOIN assessments a ON a.id = e.assessment_id
     LEFT JOIN appeals ap ON ap.event_id = e.id
     WHERE e.user_id = $1 AND e.wave_id = $2
     ORDER BY e.created_at ASC, e.id ASC`,
    [userId, waveId],
  );

  return res.rows;
}

export async function findUserEvents(
  userId: string,
  options: {
    status?: string;
    cursor?: DecodedCursor | null;
    limit: number;
  },
  client?: PoolClient,
): Promise<EventJoinedRow[]> {
  const executor = client ?? getPool();
  const limitPlusOne = options.limit + 1;

  const cursorCreatedAt = options.cursor ? options.cursor.createdAt : null;
  const cursorId = options.cursor ? options.cursor.id : null;
  const statusFilter = options.status ?? null;

  const res = await executor.query<EventJoinedRow>(
    `SELECT
       e.id,
       e.kind,
       e.value,
       e.status,
       w.number AS wave_number,
       e.void_reason,
       e.post_id,
       p.body AS post_body,
       e.assessment_id,
       a.verdict AS assessment_verdict,
       a.source AS assessment_source,
       a.created_at AS assessment_created_at,
       a.rationale AS assessment_rationale,
       e.reverses_event_id,
       ap.id AS appeal_id,
       ap.status AS appeal_status,
       e.created_at
     FROM reputation_events e
     LEFT JOIN waves w ON w.id = e.wave_id
     JOIN posts p ON p.id = e.post_id
     LEFT JOIN assessments a ON a.id = e.assessment_id
     LEFT JOIN appeals ap ON ap.event_id = e.id
     WHERE e.user_id = $1
       AND ($2::text IS NULL OR e.status = $2)
       AND (
         $3::timestamptz IS NULL
         OR (e.created_at, e.id) < ($3, $4::uuid)
       )
     ORDER BY e.created_at DESC, e.id DESC
     LIMIT $5`,
    [userId, statusFilter, cursorCreatedAt, cursorId, limitPlusOne],
  );

  return res.rows;
}

export async function findEventByIdAndUser(
  eventId: string,
  userId: string,
  client?: PoolClient,
): Promise<{
  id: string;
  user_id: string;
  kind: string;
  status: string;
  assessment_id: string;
  assessment_created_at: Date;
  post_id: string;
  has_appeal: boolean;
} | null> {
  const executor = client ?? getPool();
  const res = await executor.query<{
    id: string;
    user_id: string;
    kind: string;
    status: string;
    assessment_id: string;
    assessment_created_at: Date;
    post_id: string;
    has_appeal: boolean;
  }>(
    `SELECT
       e.id,
       e.user_id,
       e.kind,
       e.status,
        e.assessment_id,
        e.post_id,
        a.created_at AS assessment_created_at,
       EXISTS(SELECT 1 FROM appeals WHERE event_id = e.id) AS has_appeal
     FROM reputation_events e
     JOIN assessments a ON a.id = e.assessment_id
      WHERE e.id = $1 AND e.user_id = $2
      ${client ? 'FOR UPDATE OF e' : ''}`,
    [eventId, userId],
  );

  return res.rows[0] ?? null;
}

export async function insertAppeal(
  params: {
    eventId: string;
    assessmentId: string;
    appellantId: string;
    reason: string;
  },
  client: PoolClient,
): Promise<AppealRow> {
  // If event is currently 'eligible', set to 'held' and remove from current wave (RUL-016)
  await client.query(
    `UPDATE reputation_events
     SET status = 'held', wave_id = NULL
     WHERE id = $1 AND status = 'eligible'`,
    [params.eventId],
  );

  const res = await client.query<AppealRow>(
    `INSERT INTO appeals (
       event_id,
       assessment_id,
       appellant_id,
       reason,
       status
     ) VALUES ($1, $2, $3, $4, 'open')
     RETURNING *`,
    [params.eventId, params.assessmentId, params.appellantId, params.reason],
  );

  return res.rows[0]!;
}

export async function findUserAppeals(
  userId: string,
  options: {
    cursor?: DecodedCursor | null;
    limit: number;
  },
  client?: PoolClient,
): Promise<AppealRow[]> {
  const executor = client ?? getPool();
  const limitPlusOne = options.limit + 1;

  const cursorCreatedAt = options.cursor ? options.cursor.createdAt : null;
  const cursorId = options.cursor ? options.cursor.id : null;

  const res = await executor.query<AppealRow>(
    `SELECT
       id,
       event_id,
       assessment_id,
       appellant_id,
       reason,
       status,
       resolution_note,
       created_at,
       resolved_at
     FROM appeals
      WHERE appellant_id = $1
        AND (
          $2::timestamptz IS NULL
          OR (date_trunc('milliseconds', created_at), id) < ($2, $3::uuid)
        )
      ORDER BY date_trunc('milliseconds', created_at) DESC, id DESC
     LIMIT $4`,
    [userId, cursorCreatedAt, cursorId, limitPlusOne],
  );

  return res.rows;
}
