/** Admin CSV exports for ledger, events, and assessments (TASK-074, RFC 4180). */

import { getPool } from '../../db/pool.js';

export function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  const str = value instanceof Date ? value.toISOString() : String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function serializeCsv(headers: string[], rows: unknown[][]): string {
  const headerLine = headers.map(escapeCsvField).join(',');
  const rowLines = rows.map((row) => row.map(escapeCsvField).join(','));
  return [headerLine, ...rowLines].join('\r\n') + '\r\n';
}

export async function exportLedgerCsv(waveNumber?: number): Promise<string> {
  const headers = [
    'wave_number',
    'user_id',
    'username',
    'n_pos',
    'n_neg',
    'n_adj',
    'r',
    'sigma_used',
    'q_before',
    'delta',
    'q_after',
    'formula_version',
    'created_at',
  ];

  const pool = getPool();
  const result = await pool.query<{
    wave_number: number;
    user_id: string;
    username: string;
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
  }>(
    `SELECT
       w.number AS wave_number,
       uwr.user_id,
       u.username,
       uwr.n_pos,
       uwr.n_neg,
       uwr.n_adj,
       uwr.r,
       uwr.sigma_used,
       uwr.q_before,
       uwr.delta,
       uwr.q_after,
       uwr.formula_version,
       uwr.created_at
     FROM user_wave_reputation uwr
     JOIN waves w ON w.id = uwr.wave_id
     JOIN users u ON u.id = uwr.user_id
     WHERE ($1::int IS NULL OR w.number = $1)
     ORDER BY w.number ASC, uwr.created_at ASC, u.username ASC`,
    [waveNumber ?? null],
  );

  const rows = result.rows.map((r) => [
    r.wave_number,
    r.user_id,
    r.username,
    r.n_pos,
    r.n_neg,
    r.n_adj,
    r.r,
    r.sigma_used,
    r.q_before,
    r.delta,
    r.q_after,
    r.formula_version,
    r.created_at.toISOString(),
  ]);

  return serializeCsv(headers, rows);
}

export async function exportEventsCsv(waveNumber?: number): Promise<string> {
  const headers = [
    'id',
    'user_id',
    'username',
    'post_id',
    'assessment_id',
    'report_id',
    'reshare_post_id',
    'kind',
    'value',
    'status',
    'wave_number',
    'reverses_event_id',
    'void_reason',
    'created_at',
    'updated_at',
  ];

  const pool = getPool();
  const result = await pool.query<{
    id: string;
    user_id: string;
    username: string;
    post_id: string;
    assessment_id: string;
    report_id: string | null;
    reshare_post_id: string | null;
    kind: string;
    value: number;
    status: string;
    wave_number: number | null;
    reverses_event_id: string | null;
    void_reason: string | null;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT
       e.id,
       e.user_id,
       u.username,
       e.post_id,
       e.assessment_id,
       e.report_id,
       e.reshare_post_id,
       e.kind,
       e.value,
       e.status,
       w.number AS wave_number,
       e.reverses_event_id,
       e.void_reason,
       e.created_at,
       e.updated_at
     FROM reputation_events e
     JOIN users u ON u.id = e.user_id
     LEFT JOIN waves w ON w.id = e.wave_id
     WHERE ($1::int IS NULL OR w.number = $1)
     ORDER BY e.created_at ASC, e.id ASC`,
    [waveNumber ?? null],
  );

  const rows = result.rows.map((r) => [
    r.id,
    r.user_id,
    r.username,
    r.post_id,
    r.assessment_id,
    r.report_id ?? '',
    r.reshare_post_id ?? '',
    r.kind,
    r.value,
    r.status,
    r.wave_number ?? '',
    r.reverses_event_id ?? '',
    r.void_reason ?? '',
    r.created_at.toISOString(),
    r.updated_at.toISOString(),
  ]);

  return serializeCsv(headers, rows);
}

export async function exportAssessmentsCsv(waveNumber?: number): Promise<string> {
  const headers = [
    'id',
    'post_id',
    'post_revision',
    'verdict',
    'source',
    'decided_by',
    'decided_by_username',
    'rationale',
    'detection_result_id',
    'supersedes_id',
    'is_current',
    'wave_number',
    'created_at',
  ];

  const pool = getPool();
  const result = await pool.query<{
    id: string;
    post_id: string;
    post_revision: number;
    verdict: string;
    source: string;
    decided_by: string | null;
    decided_by_username: string | null;
    rationale: string;
    detection_result_id: string | null;
    supersedes_id: string | null;
    is_current: boolean;
    wave_number: number | null;
    created_at: Date;
  }>(
    `SELECT
       a.id,
       a.post_id,
       a.post_revision,
       a.verdict,
       a.source,
       a.decided_by,
       u.username AS decided_by_username,
       a.rationale,
       a.detection_result_id,
       a.supersedes_id,
       a.is_current,
       w.number AS wave_number,
       a.created_at
     FROM assessments a
     LEFT JOIN users u ON u.id = a.decided_by
     LEFT JOIN waves w
       ON a.created_at >= w.opened_at
      AND (w.finalized_at IS NULL OR a.created_at < w.finalized_at)
     WHERE ($1::int IS NULL OR w.number = $1)
     ORDER BY a.created_at ASC, a.id ASC`,
    [waveNumber ?? null],
  );

  const rows = result.rows.map((r) => [
    r.id,
    r.post_id,
    r.post_revision,
    r.verdict,
    r.source,
    r.decided_by ?? '',
    r.decided_by_username ?? '',
    r.rationale,
    r.detection_result_id ?? '',
    r.supersedes_id ?? '',
    r.is_current,
    r.wave_number ?? '',
    r.created_at.toISOString(),
  ]);

  return serializeCsv(headers, rows);
}
