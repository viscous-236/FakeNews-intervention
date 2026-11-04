/**
 * apps/api/src/scoring/verify.ts (TASK-023)
 *
 * Verifies ledger and scoring invariants (I1 through I6 per Section 1.5):
 *   - I1: q_before continuity across waves
 *   - I2: r = n_pos - n_neg + n_adj and q_after = q_before + sigma_used * r
 *   - I3: users.q = latest q_after and sigma * sum(r)
 *   - I4: sigma_used = users.sigma
 *   - I5: n_pos, n_neg, n_adj match counted events
 *   - I6: no eligible event points to a finalized wave
 */

import Decimal from 'decimal.js';
import { getPool, type PoolClient, type Pool } from '../db/pool.js';
import { verifyUserHistory, type PureLedgerRow } from './pure.js';

export interface ScoreIssue {
  invariant: string;
  userId: string;
  waveId?: string;
  expected: string;
  actual: string;
  message?: string;
}

export interface VerifyScoresResult {
  ok: boolean;
  issues: ScoreIssue[];
}

interface UserDbRow {
  id: string;
  sigma: string;
  q: string;
}

interface LedgerDbRow {
  user_id: string;
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
}

interface CountedAggregateRow {
  user_id: string;
  wave_id: string;
  n_pos: string;
  n_neg: string;
  n_adj: string;
}

interface FinalizedEligibleEventRow {
  id: string;
  user_id: string;
  wave_id: string;
  wave_number: number;
}

export async function verifyScores(client?: PoolClient | Pool): Promise<VerifyScoresResult> {
  const db = client ?? getPool();
  const issues: ScoreIssue[] = [];

  // 1. Fetch all users
  const usersRes = await db.query<UserDbRow>(`SELECT id, sigma, q FROM users ORDER BY id ASC`);

  // 2. Fetch all ledger rows with wave numbers
  const ledgerRes = await db.query<LedgerDbRow>(
    `SELECT
       uwr.user_id,
       uwr.wave_id,
       w.number AS wave_number,
       uwr.n_pos,
       uwr.n_neg,
       uwr.n_adj,
       uwr.r,
       uwr.sigma_used,
       uwr.q_before,
       uwr.delta,
       uwr.q_after,
       uwr.formula_version
     FROM user_wave_reputation uwr
     JOIN waves w ON w.id = uwr.wave_id
     ORDER BY uwr.user_id ASC, w.number ASC`,
  );

  // Group ledger rows by user_id
  const userLedgerMap = new Map<string, LedgerDbRow[]>();
  for (const row of ledgerRes.rows) {
    let list = userLedgerMap.get(row.user_id);
    if (!list) {
      list = [];
      userLedgerMap.set(row.user_id, list);
    }
    list.push(row);
  }

  // Check I1-I4 for each user using verifyUserHistory
  for (const user of usersRes.rows) {
    const userRows = userLedgerMap.get(user.id) ?? [];
    const pureRows: PureLedgerRow[] = userRows.map((r) => ({
      waveNumber: r.wave_number,
      nPos: r.n_pos,
      nNeg: r.n_neg,
      nAdj: r.n_adj,
      r: r.r,
      sigmaUsed: r.sigma_used,
      qBefore: r.q_before,
      delta: r.delta,
      qAfter: r.q_after,
    }));

    const pureIssues = verifyUserHistory(new Decimal(user.sigma), pureRows, new Decimal(user.q));

    for (const pi of pureIssues) {
      const matchRow = userRows.find((r) => r.wave_number === pi.waveNumber);
      issues.push({
        invariant: pi.invariant,
        userId: user.id,
        waveId: matchRow?.wave_id,
        expected: pi.expected,
        actual: pi.actual,
        message: pi.message,
      });
    }
  }

  // 3. Check I5: Event counts match ledger rows
  const countedAggRes = await db.query<CountedAggregateRow>(
    `SELECT
       ledger_user_id AS user_id,
       ledger_wave_id AS wave_id,
       count(*) FILTER (WHERE kind IN ('RESPONSIBLE_POST','RESPONSIBLE_RESHARE','VALID_REPORT')) AS n_pos,
       count(*) FILTER (WHERE kind IN ('MISINFO_POST','MISINFO_RESHARE','MISINFO_LIKE')) AS n_neg,
       COALESCE(sum(value) FILTER (WHERE kind = 'REVERSAL'), 0) AS n_adj
     FROM reputation_events
     WHERE status = 'counted'
     GROUP BY ledger_user_id, ledger_wave_id`,
  );

  const countedMap = new Map<string, { nPos: number; nNeg: number; nAdj: number }>();
  for (const row of countedAggRes.rows) {
    countedMap.set(`${row.user_id}:${row.wave_id}`, {
      nPos: parseInt(row.n_pos, 10) || 0,
      nNeg: parseInt(row.n_neg, 10) || 0,
      nAdj: parseInt(row.n_adj, 10) || 0,
    });
  }

  for (const uwr of ledgerRes.rows) {
    const counted = countedMap.get(`${uwr.user_id}:${uwr.wave_id}`) ?? {
      nPos: 0,
      nNeg: 0,
      nAdj: 0,
    };

    if (uwr.n_pos !== counted.nPos) {
      issues.push({
        invariant: 'I5',
        userId: uwr.user_id,
        waveId: uwr.wave_id,
        expected: String(counted.nPos),
        actual: String(uwr.n_pos),
        message: `Wave ${uwr.wave_number} n_pos (${uwr.n_pos}) does not match counted events (${counted.nPos})`,
      });
    }
    if (uwr.n_neg !== counted.nNeg) {
      issues.push({
        invariant: 'I5',
        userId: uwr.user_id,
        waveId: uwr.wave_id,
        expected: String(counted.nNeg),
        actual: String(uwr.n_neg),
        message: `Wave ${uwr.wave_number} n_neg (${uwr.n_neg}) does not match counted events (${counted.nNeg})`,
      });
    }
    if (uwr.n_adj !== counted.nAdj) {
      issues.push({
        invariant: 'I5',
        userId: uwr.user_id,
        waveId: uwr.wave_id,
        expected: String(counted.nAdj),
        actual: String(uwr.n_adj),
        message: `Wave ${uwr.wave_number} n_adj (${uwr.n_adj}) does not match counted events (${counted.nAdj})`,
      });
    }
  }

  // 4. Check I6: No eligible event pointing to a finalized wave
  const eligibleFinalizedRes = await db.query<FinalizedEligibleEventRow>(
    `SELECT e.id, e.user_id, e.wave_id, w.number AS wave_number
     FROM reputation_events e
     JOIN waves w ON w.id = e.wave_id
     WHERE e.status = 'eligible' AND w.status = 'finalized'`,
  );

  for (const ev of eligibleFinalizedRes.rows) {
    issues.push({
      invariant: 'I6',
      userId: ev.user_id,
      waveId: ev.wave_id,
      expected: 'open wave',
      actual: `finalized wave ${ev.wave_number}`,
      message: `Eligible event ${ev.id} points to finalized wave ${ev.wave_number}`,
    });
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}
