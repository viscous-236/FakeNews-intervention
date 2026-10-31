/**
 * apps/api/test/scoring/pure.test.ts (TASK-020)
 *
 * Tests TEST-001 through TEST-012 for the paper's pure scoring functions.
 */

import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import {
  computeR,
  applyUpdate,
  foldHistory,
  decomposedScore,
  verifyUserHistory,
  type PureLedgerRow,
} from '../../src/scoring/pure.js';

describe('Pure Scoring Engine (TASK-020: TEST-001 to TEST-012)', () => {
  // TEST-001: Decomposition
  it('TEST-001: Decomposition: sigma = 0.5, R = [3, -1, 2, 0, 4] gives 1.5, 1.0, 2.0, 2.0, 4.0; final equals sigma * sum(R) = 4.0', () => {
    const sigma = new Decimal('0.5');
    const rs = [3, -1, 2, 0, 4];
    const expectedIntermediate = ['1.5', '1.0', '2.0', '2.0', '4.0'];

    let q = new Decimal(0);
    rs.forEach((r, idx) => {
      const update = applyUpdate(q, sigma, r);
      q = update.qAfter;
      expect(q.toFixed(1)).toBe(expectedIntermediate[idx]);
    });

    const finalDecomposed = decomposedScore(sigma, rs);
    expect(q.toFixed(1)).toBe('4.0');
    expect(finalDecomposed.toFixed(1)).toBe('4.0');
  });

  // TEST-002: Monotone non-decreasing
  it('TEST-002: Monotone non-decreasing: sigma = 0.8, R = [1, 0, 2, 3] gives 0.8, 0.8, 2.4, 4.8', () => {
    const sigma = new Decimal('0.8');
    const rs = [1, 0, 2, 3];
    const expected = ['0.8', '0.8', '2.4', '4.8'];

    let q = new Decimal(0);
    rs.forEach((r, idx) => {
      const update = applyUpdate(q, sigma, r);
      q = update.qAfter;
      expect(q.toString()).toBe(expected[idx]);
    });
  });

  // TEST-003: Monotone non-increasing
  it('TEST-003: Monotone non-increasing: sigma = 0.8, R = [-1, 0, -2, -3] gives -0.8, -0.8, -2.4, -4.8', () => {
    const sigma = new Decimal('0.8');
    const rs = [-1, 0, -2, -3];
    const expected = ['-0.8', '-0.8', '-2.4', '-4.8'];

    let q = new Decimal(0);
    rs.forEach((r, idx) => {
      const update = applyUpdate(q, sigma, r);
      q = update.qAfter;
      expect(q.toString()).toBe(expected[idx]);
    });
  });

  // TEST-004: Sensitivity scaling
  it('TEST-004: Sensitivity scaling: R = [2, -1, 3], sigma_a = 1.0, sigma_b = 0.25: finals 4.0 and 1.0, and abs(Qa) > abs(Qb)', () => {
    const rs = [2, -1, 3];
    const qa = foldHistory(new Decimal('1.0'), rs);
    const qb = foldHistory(new Decimal('0.25'), rs);

    expect(qa.toString()).toBe('4');
    expect(qb.toString()).toBe('1');
    expect(qa.abs().greaterThan(qb.abs())).toBe(true);
  });

  // TEST-005: Scaling caveat
  it('TEST-005: Scaling caveat: R = [2, -2] (sum 0) gives final Q = 0 for any sigma', () => {
    const rs = [2, -2];
    expect(foldHistory(new Decimal('0.1'), rs).toString()).toBe('0');
    expect(foldHistory(new Decimal('0.5'), rs).toString()).toBe('0');
    expect(foldHistory(new Decimal('1.0'), rs).toString()).toBe('0');
  });

  // TEST-006: sigma = 0
  it('TEST-006: sigma = 0 with R = [5, -3, 7] gives Q = 0 for all waves', () => {
    const sigma = new Decimal('0');
    const rs = [5, -3, 7];

    let q = new Decimal(0);
    rs.forEach((r) => {
      const update = applyUpdate(q, sigma, r);
      q = update.qAfter;
      expect(q.toString()).toBe('0');
    });
    expect(foldHistory(sigma, rs).toString()).toBe('0');
  });

  // TEST-007: sigma = 1
  it('TEST-007: sigma = 1 with R = [2, -1, 4] gives 2, 1, 5', () => {
    const sigma = new Decimal('1');
    const rs = [2, -1, 4];
    const expected = ['2', '1', '5'];

    let q = new Decimal(0);
    rs.forEach((r, idx) => {
      const update = applyUpdate(q, sigma, r);
      q = update.qAfter;
      expect(q.toString()).toBe(expected[idx]);
    });
  });

  // TEST-008: R = 0 for all waves
  it('TEST-008: R = 0 for all waves, sigma = 0.7 gives 0, 0, 0', () => {
    const sigma = new Decimal('0.7');
    const rs = [0, 0, 0];

    let q = new Decimal(0);
    rs.forEach((r) => {
      const update = applyUpdate(q, sigma, r);
      q = update.qAfter;
      expect(q.toString()).toBe('0');
    });
  });

  // TEST-009: Alternating
  it('TEST-009: Alternating: sigma = 0.5, R = [2, -2, 2, -2, 2] gives 1, 0, 1, 0, 1', () => {
    const sigma = new Decimal('0.5');
    const rs = [2, -2, 2, -2, 2];
    const expected = ['1', '0', '1', '0', '1'];

    let q = new Decimal(0);
    rs.forEach((r, idx) => {
      const update = applyUpdate(q, sigma, r);
      q = update.qAfter;
      expect(q.toString()).toBe(expected[idx]);
    });
  });

  // TEST-010: Opposite behaviour
  it('TEST-010: Opposite behaviour: sigma = 0.6, user i R = +3 and user j R = -3 for 4 waves gives Qi = 7.2, Qj = -7.2, diff = 14.4', () => {
    const sigma = new Decimal('0.6');
    const rPos = [3, 3, 3, 3];
    const rNeg = [-3, -3, -3, -3];

    const qi = foldHistory(sigma, rPos);
    const qj = foldHistory(sigma, rNeg);

    expect(qi.toString()).toBe('7.2');
    expect(qj.toString()).toBe('-7.2');
    expect(qi.minus(qj).toString()).toBe('14.4');
  });

  // TEST-011: computeR with adjustments
  it('TEST-011: computeR with adjustments: (3, 1, -1) gives 1; (0, 0, 0) gives 0; (0, 2, 1) gives -1', () => {
    expect(computeR({ nPos: 3, nNeg: 1, nAdj: -1 })).toBe(1);
    expect(computeR({ nPos: 0, nNeg: 0, nAdj: 0 })).toBe(0);
    expect(computeR({ nPos: 0, nNeg: 2, nAdj: 1 })).toBe(-1);
  });

  // TEST-012: Decimal exactness
  it('TEST-012: Decimal exactness: sigma = 0.100, R = 3 applied 10 times equals exactly 3.000; 1000 generated histories match decomposedScore', () => {
    const sigma = new Decimal('0.100');
    let q = new Decimal(0);
    for (let i = 0; i < 10; i++) {
      q = applyUpdate(q, sigma, 3).qAfter;
    }
    expect(q.toString()).toBe('3');

    // Pseudo-random deterministic LCG for 1,000 histories
    let seed = 42;
    function nextInt(min: number, max: number): number {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return min + (Math.abs(seed) % (max - min + 1));
    }

    for (let h = 0; h < 1000; h++) {
      const s = new Decimal((nextInt(1, 100) / 100).toFixed(2));
      const len = nextInt(1, 15);
      const rs: number[] = [];
      for (let w = 0; w < len; w++) {
        rs.push(nextInt(-5, 5));
      }
      const folded = foldHistory(s, rs);
      const decomposed = decomposedScore(s, rs);
      expect(folded.equals(decomposed)).toBe(true);
    }
  });
});

describe('verifyUserHistory Invariant Checks (I1 to I5)', () => {
  const sigma = new Decimal('0.500');

  it('valid history produces zero issues', () => {
    const rows: PureLedgerRow[] = [
      {
        waveNumber: 1,
        nPos: 2,
        nNeg: 0,
        nAdj: 0,
        r: 2,
        sigmaUsed: '0.500',
        qBefore: '0',
        delta: '1',
        qAfter: '1',
      },
      {
        waveNumber: 2,
        nPos: 0,
        nNeg: 1,
        nAdj: 0,
        r: -1,
        sigmaUsed: '0.500',
        qBefore: '1',
        delta: '-0.5',
        qAfter: '0.5',
      },
    ];

    const issues = verifyUserHistory(sigma, rows, new Decimal('0.5'));
    expect(issues).toHaveLength(0);
  });

  it('empty history with currentQ = 0 produces zero issues', () => {
    const issues = verifyUserHistory(sigma, [], new Decimal('0'));
    expect(issues).toHaveLength(0);
  });

  it('empty history with non-zero currentQ detects I3 issue', () => {
    const issues = verifyUserHistory(sigma, [], new Decimal('1.5'));
    expect(issues.some((i) => i.invariant === 'I3')).toBe(true);
  });

  it('first row with non-zero qBefore detects I1 issue', () => {
    const rows: PureLedgerRow[] = [
      {
        waveNumber: 1,
        nPos: 1,
        nNeg: 0,
        nAdj: 0,
        r: 1,
        sigmaUsed: '0.500',
        qBefore: '0.5',
        delta: '0.5',
        qAfter: '1',
      },
    ];
    const issues = verifyUserHistory(sigma, rows, new Decimal('1'));
    expect(issues.some((i) => i.invariant === 'I1')).toBe(true);
  });

  it('discontinuous qBefore detects I1 issue', () => {
    const rows: PureLedgerRow[] = [
      {
        waveNumber: 1,
        nPos: 1,
        nNeg: 0,
        nAdj: 0,
        r: 1,
        sigmaUsed: '0.500',
        qBefore: '0',
        delta: '0.5',
        qAfter: '0.5',
      },
      {
        waveNumber: 2,
        nPos: 1,
        nNeg: 0,
        nAdj: 0,
        r: 1,
        sigmaUsed: '0.500',
        qBefore: '0.8', // gap!
        delta: '0.5',
        qAfter: '1.3',
      },
    ];
    const issues = verifyUserHistory(sigma, rows, new Decimal('1.3'));
    expect(issues.some((i) => i.invariant === 'I1')).toBe(true);
  });

  it('mismatched sigma detects I4 issue', () => {
    const rows: PureLedgerRow[] = [
      {
        waveNumber: 1,
        nPos: 1,
        nNeg: 0,
        nAdj: 0,
        r: 1,
        sigmaUsed: '0.800', // differs from 0.500
        qBefore: '0',
        delta: '0.8',
        qAfter: '0.8',
      },
    ];
    const issues = verifyUserHistory(sigma, rows, new Decimal('0.8'));
    expect(issues.some((i) => i.invariant === 'I4')).toBe(true);
  });

  it('corrupted r, delta, or qAfter detects I2 issues', () => {
    const rows: PureLedgerRow[] = [
      {
        waveNumber: 1,
        nPos: 2,
        nNeg: 0,
        nAdj: 0,
        r: 5, // invalid r
        sigmaUsed: '0.500',
        qBefore: '0',
        delta: '1', // invalid delta for r=5
        qAfter: '2', // invalid qAfter
      },
    ];
    const issues = verifyUserHistory(sigma, rows, new Decimal('2'));
    expect(issues.filter((i) => i.invariant === 'I2').length).toBeGreaterThanOrEqual(1);
  });

  it('mismatched currentQ detects I3 issues', () => {
    const rows: PureLedgerRow[] = [
      {
        waveNumber: 1,
        nPos: 1,
        nNeg: 0,
        nAdj: 0,
        r: 1,
        sigmaUsed: '0.500',
        qBefore: '0',
        delta: '0.5',
        qAfter: '0.5',
      },
    ];
    const issues = verifyUserHistory(sigma, rows, new Decimal('999'));
    expect(issues.some((i) => i.invariant === 'I3')).toBe(true);
  });
});
