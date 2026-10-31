/**
 * apps/api/src/scoring/pure.ts (TASK-020)
 *
 * Pure scoring functions (REQ-003, REQ-004, REQ-018).
 * No I/O, no database, no clock, no randomness.
 *
 * Decimal precision: 28, ROUND_HALF_EVEN.
 */

import Decimal from 'decimal.js';

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_EVEN });

export interface ComputeRInput {
  nPos: number;
  nNeg: number;
  nAdj: number;
}

export interface PureLedgerRow {
  waveNumber: number;
  nPos: number;
  nNeg: number;
  nAdj: number;
  r: number;
  sigmaUsed: Decimal | string;
  qBefore: Decimal | string;
  delta: Decimal | string;
  qAfter: Decimal | string;
}

export interface VerifyIssue {
  invariant: string;
  waveNumber?: number;
  expected: string;
  actual: string;
  message: string;
}

/**
 * Compute wave reward R = n_pos - n_neg + n_adj (Equation 1).
 */
export function computeR(c: ComputeRInput): number {
  return c.nPos - c.nNeg + c.nAdj;
}

/**
 * Single wave score update (Equation 2).
 * delta = sigma * r
 * qAfter = qBefore + delta
 */
export function applyUpdate(
  qBefore: Decimal,
  sigma: Decimal,
  r: number,
): { delta: Decimal; qAfter: Decimal } {
  const delta = sigma.times(r);
  const qAfter = qBefore.plus(delta);
  return { delta, qAfter };
}

/**
 * Fold wave history starting from Q(1) = 0.
 */
export function foldHistory(sigma: Decimal, rs: number[]): Decimal {
  let q = new Decimal(0);
  for (const r of rs) {
    const { qAfter } = applyUpdate(q, sigma, r);
    q = qAfter;
  }
  return q;
}

/**
 * Decomposed score: sigma * sum(rs) (Proposition 1).
 */
export function decomposedScore(sigma: Decimal, rs: number[]): Decimal {
  const sum = rs.reduce((acc, val) => acc + val, 0);
  return sigma.times(sum);
}

/**
 * Verify in-memory ledger history for a single user against invariants I1-I5.
 */
export function verifyUserHistory(
  sigma: Decimal,
  rows: PureLedgerRow[],
  currentQ: Decimal,
): VerifyIssue[] {
  const issues: VerifyIssue[] = [];

  if (rows.length === 0) {
    if (!currentQ.equals(0)) {
      issues.push({
        invariant: 'I3',
        expected: '0',
        actual: currentQ.toString(),
        message: 'User without ledger rows must have currentQ = 0',
      });
    }
    return issues;
  }

  let prevQAfter = new Decimal(0);
  let sumR = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const qBefore = new Decimal(row.qBefore);
    const sigmaUsed = new Decimal(row.sigmaUsed);
    const delta = new Decimal(row.delta);
    const qAfter = new Decimal(row.qAfter);

    // I1: q_before continuity
    if (i === 0) {
      if (!qBefore.equals(0)) {
        issues.push({
          invariant: 'I1',
          waveNumber: row.waveNumber,
          expected: '0',
          actual: qBefore.toString(),
          message: 'First wave q_before must be 0',
        });
      }
    } else {
      if (!qBefore.equals(prevQAfter)) {
        issues.push({
          invariant: 'I1',
          waveNumber: row.waveNumber,
          expected: prevQAfter.toString(),
          actual: qBefore.toString(),
          message: `Wave ${row.waveNumber} q_before must equal previous q_after`,
        });
      }
    }

    // I4: sigma_used matches user.sigma
    if (!sigmaUsed.equals(sigma)) {
      issues.push({
        invariant: 'I4',
        waveNumber: row.waveNumber,
        expected: sigma.toString(),
        actual: sigmaUsed.toString(),
        message: `Wave ${row.waveNumber} sigma_used must equal user sigma`,
      });
    }

    // I2: r = n_pos - n_neg + n_adj and q_after = q_before + sigma_used * r
    const expectedR = computeR({ nPos: row.nPos, nNeg: row.nNeg, nAdj: row.nAdj });
    if (row.r !== expectedR) {
      issues.push({
        invariant: 'I2',
        waveNumber: row.waveNumber,
        expected: expectedR.toString(),
        actual: row.r.toString(),
        message: `Wave ${row.waveNumber} r does not match n_pos - n_neg + n_adj`,
      });
    }

    const expectedDelta = sigmaUsed.times(row.r);
    if (!delta.equals(expectedDelta)) {
      issues.push({
        invariant: 'I2',
        waveNumber: row.waveNumber,
        expected: expectedDelta.toString(),
        actual: delta.toString(),
        message: `Wave ${row.waveNumber} delta must equal sigma_used * r`,
      });
    }

    const expectedQAfter = qBefore.plus(delta);
    if (!qAfter.equals(expectedQAfter)) {
      issues.push({
        invariant: 'I2',
        waveNumber: row.waveNumber,
        expected: expectedQAfter.toString(),
        actual: qAfter.toString(),
        message: `Wave ${row.waveNumber} q_after must equal q_before + delta`,
      });
    }

    prevQAfter = qAfter;
    sumR += row.r;
  }

  // I3: currentQ matches latest q_after and sigma * sum(r)
  const lastRow = rows[rows.length - 1]!;
  const lastQAfter = new Decimal(lastRow.qAfter);
  if (!currentQ.equals(lastQAfter)) {
    issues.push({
      invariant: 'I3',
      expected: lastQAfter.toString(),
      actual: currentQ.toString(),
      message: 'currentQ must equal latest ledger row q_after',
    });
  }

  const expectedPropositionScore = sigma.times(sumR);
  if (!currentQ.equals(expectedPropositionScore)) {
    issues.push({
      invariant: 'I3',
      expected: expectedPropositionScore.toString(),
      actual: currentQ.toString(),
      message: 'currentQ must equal sigma * sum(r)',
    });
  }

  return issues;
}
