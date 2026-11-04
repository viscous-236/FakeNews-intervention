/**
 * apps/api/test/scoring/finalize.test.ts (TASK-026)
 *
 * Tests TEST-013 through TEST-020:
 *   - TEST-013: 5 waves with R = [3, -1, 2, 0, 4], sigma = 0.5 -> Q = 4.000
 *   - TEST-014: Proportional sensitivity: sigma = 0.8 vs 0.4 (Q_a = 2 * Q_b), sigma = 1.0 vs 0.25
 *   - TEST-015: Boundary sigma: sigma = 0.0 stays at 0.000; sigma = 1.0 delta equals r
 *   - TEST-016: Finalize idempotency: calling twice returns alreadyFinalized = true and changes nothing
 *   - TEST-017: Concurrent finalization: 10 parallel calls produce exactly 1 finalization and 1 new wave
 *   - TEST-018: Bystanders and users created during open wave receive r = 0 ledger rows
 *   - TEST-019: Persistence across pool restart: scores and ledger match across pool recreate
 *   - TEST-020: Invariant verification: verifyScores() passes (I1-I6) after multi-wave scenario
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Pool } from 'pg';
import { getTestPool, closeTestPool, truncateAll } from '../setup/db.js';
import { createUser } from '../../src/modules/users/service.js';
import { finalizeWave } from '../../src/scoring/finalizeWave.js';
import { verifyScores } from '../../src/scoring/verify.js';

describe('Wave Finalization Integration (TEST-013 through TEST-020)', () => {
  let pool: Pool;
  let adminId: string;

  beforeAll(async () => {
    await truncateAll();
    pool = getTestPool();

    // Create an admin to decide assessments
    const admin = await createUser({
      username: 'admin_scorer',
      email: 'admin_scorer@example.com',
      password: 'password12345',
      displayName: 'Scoring Admin',
      role: 'admin',
    });
    adminId = admin.id;
  });

  afterAll(async () => {
    await closeTestPool();
  });

  async function getOpenWave(): Promise<{ id: string; number: number }> {
    const res = await pool.query<{ id: string; number: number }>(
      `SELECT id, number FROM waves WHERE status = 'open'`,
    );
    return res.rows[0]!;
  }

  async function createPostAndAssessment(
    authorId: string,
    verdict: 'real' | 'fake' = 'real',
  ): Promise<{ postId: string; assessmentId: string }> {
    const postRes = await pool.query<{ id: string }>(
      `INSERT INTO posts (author_id, kind, body, author_tier_at_post)
       VALUES ($1, 'original', 'Test post body content', 'neutral')
       RETURNING id`,
      [authorId],
    );
    const postId = postRes.rows[0]!.id;

    const assessRes = await pool.query<{ id: string }>(
      `INSERT INTO assessments (post_id, post_revision, verdict, source, decided_by, rationale)
       VALUES ($1, 1, $2, 'admin', $3, 'A valid rationale of required length')
       RETURNING id`,
      [postId, verdict, adminId],
    );
    const assessmentId = assessRes.rows[0]!.id;

    return { postId, assessmentId };
  }

  it('TEST-013: 5 waves with R = [3, -1, 2, 0, 4] over database produces Q = 4.000 for sigma = 0.5', async () => {
    const user = await createUser({
      username: 'test013_user',
      email: 'test013@example.com',
      password: 'password12345',
      displayName: 'User 013',
      sigma: 0.5,
    });

    const targetRs = [3, -1, 2, 0, 4];
    const expectedQAfters = ['1.500', '1.000', '2.000', '2.000', '4.000'];

    for (let i = 0; i < targetRs.length; i++) {
      const targetR = targetRs[i]!;
      const openWave = await getOpenWave();

      if (targetR > 0) {
        for (let j = 0; j < targetR; j++) {
          const { postId, assessmentId } = await createPostAndAssessment(user.id, 'real');
          await pool.query(
            `INSERT INTO reputation_events (
               user_id, post_id, assessment_id, kind, value, status, wave_id
             ) VALUES ($1, $2, $3, 'RESPONSIBLE_POST', 1, 'eligible', $4)`,
            [user.id, postId, assessmentId, openWave.id],
          );
        }
      } else if (targetR < 0) {
        for (let j = 0; j < Math.abs(targetR); j++) {
          const { postId, assessmentId } = await createPostAndAssessment(user.id, 'fake');
          await pool.query(
            `INSERT INTO reputation_events (
               user_id, post_id, assessment_id, kind, value, status, wave_id
             ) VALUES ($1, $2, $3, 'MISINFO_LIKE', -1, 'eligible', $4)`,
            [user.id, postId, assessmentId, openWave.id],
          );
        }
      }

      const finRes = await finalizeWave(openWave.id, { kind: 'admin', userId: adminId });
      expect(finRes.alreadyFinalized).toBe(false);

      // Verify ledger row for this wave
      const ledgerRes = await pool.query<{ q_after: string; r: number }>(
        `SELECT q_after, r FROM user_wave_reputation WHERE user_id = $1 AND wave_id = $2`,
        [user.id, openWave.id],
      );
      expect(ledgerRes.rows[0]!.r).toBe(targetR);
      expect(ledgerRes.rows[0]!.q_after).toBe(expectedQAfters[i]);
    }

    // Verify final user score
    const userRes = await pool.query<{ q: string }>(`SELECT q FROM users WHERE id = $1`, [user.id]);
    expect(userRes.rows[0]!.q).toBe('4.000');
  });

  it('TEST-014: Proportional sensitivity: sigma 0.8 vs 0.4 yields Q_a = 2 * Q_b', async () => {
    const userA = await createUser({
      username: 'user_08_sigma',
      email: 'user08@example.com',
      password: 'password12345',
      displayName: 'User 0.8',
      sigma: 0.8,
    });
    const userB = await createUser({
      username: 'user_04_sigma',
      email: 'user04@example.com',
      password: 'password12345',
      displayName: 'User 0.4',
      sigma: 0.4,
    });
    const userC = await createUser({
      username: 'user_10_sigma',
      email: 'user10@example.com',
      password: 'password12345',
      displayName: 'User 1.0',
      sigma: 1.0,
    });
    const userD = await createUser({
      username: 'user_025_sigma',
      email: 'user025@example.com',
      password: 'password12345',
      displayName: 'User 0.25',
      sigma: 0.25,
    });

    // Wave 1: R = 4 for all four users
    const openWave = await getOpenWave();
    for (const u of [userA, userB, userC, userD]) {
      for (let k = 0; k < 4; k++) {
        const { postId, assessmentId } = await createPostAndAssessment(u.id, 'real');
        await pool.query(
          `INSERT INTO reputation_events (
             user_id, post_id, assessment_id, kind, value, status, wave_id
           ) VALUES ($1, $2, $3, 'RESPONSIBLE_POST', 1, 'eligible', $4)`,
          [u.id, postId, assessmentId, openWave.id],
        );
      }
    }

    await finalizeWave(openWave.id, { kind: 'system' });

    const scoreRes = await pool.query<{ id: string; q: string }>(
      `SELECT id, q FROM users WHERE id = ANY($1)`,
      [[userA.id, userB.id, userC.id, userD.id]],
    );
    const scoreMap = new Map(scoreRes.rows.map((r) => [r.id, parseFloat(r.q)]));

    const qA = scoreMap.get(userA.id)!;
    const qB = scoreMap.get(userB.id)!;
    const qC = scoreMap.get(userC.id)!;
    const qD = scoreMap.get(userD.id)!;

    expect(qA).toBeCloseTo(3.2, 3);
    expect(qB).toBeCloseTo(1.6, 3);
    expect(qA).toBeCloseTo(2 * qB, 3);

    expect(qC).toBeCloseTo(4.0, 3);
    expect(qD).toBeCloseTo(1.0, 3);
  });

  it('TEST-015: Boundary sigma: sigma = 0 stays at 0.000 while recording r; sigma = 1 delta equals r', async () => {
    const userZero = await createUser({
      username: 'zero_sigma_user',
      email: 'zero_sigma@example.com',
      password: 'password12345',
      displayName: 'Zero Sigma',
      sigma: 0.0,
    });
    const userOne = await createUser({
      username: 'one_sigma_user',
      email: 'one_sigma@example.com',
      password: 'password12345',
      displayName: 'One Sigma',
      sigma: 1.0,
    });

    const openWave = await getOpenWave();
    for (const u of [userZero, userOne]) {
      for (let k = 0; k < 3; k++) {
        const { postId, assessmentId } = await createPostAndAssessment(u.id, 'real');
        await pool.query(
          `INSERT INTO reputation_events (
             user_id, post_id, assessment_id, kind, value, status, wave_id
           ) VALUES ($1, $2, $3, 'RESPONSIBLE_POST', 1, 'eligible', $4)`,
          [u.id, postId, assessmentId, openWave.id],
        );
      }
    }

    await finalizeWave(openWave.id, { kind: 'system' });

    const zeroLedger = await pool.query<{ r: number; delta: string; q_after: string }>(
      `SELECT r, delta, q_after FROM user_wave_reputation WHERE user_id = $1 AND wave_id = $2`,
      [userZero.id, openWave.id],
    );
    expect(zeroLedger.rows[0]!.r).toBe(3);
    expect(zeroLedger.rows[0]!.delta).toBe('0.000');
    expect(zeroLedger.rows[0]!.q_after).toBe('0.000');

    const oneLedger = await pool.query<{ r: number; delta: string; q_after: string }>(
      `SELECT r, delta, q_after FROM user_wave_reputation WHERE user_id = $1 AND wave_id = $2`,
      [userOne.id, openWave.id],
    );
    expect(oneLedger.rows[0]!.r).toBe(3);
    expect(oneLedger.rows[0]!.delta).toBe('3.000');
    expect(oneLedger.rows[0]!.q_after).toBe('3.000');
  });

  it('TEST-016: Finalize idempotency: calling twice on same wave returns alreadyFinalized = true and changes no rows', async () => {
    const openWave = await getOpenWave();

    const first = await finalizeWave(openWave.id, { kind: 'system' });
    expect(first.alreadyFinalized).toBe(false);

    const rowsBefore = await pool.query(
      `SELECT user_id, wave_id, r, q_after FROM user_wave_reputation WHERE wave_id = $1 ORDER BY user_id`,
      [openWave.id],
    );

    const second = await finalizeWave(openWave.id, { kind: 'system' });
    expect(second.alreadyFinalized).toBe(true);
    expect(second.usersScored).toBe(0);
    expect(second.eventsCounted).toBe(0);

    const rowsAfter = await pool.query(
      `SELECT user_id, wave_id, r, q_after FROM user_wave_reputation WHERE wave_id = $1 ORDER BY user_id`,
      [openWave.id],
    );
    expect(rowsAfter.rows).toEqual(rowsBefore.rows);
  });

  it('TEST-017: 10 parallel finalize calls produce exactly one finalization, one new wave, and 1 row per user', async () => {
    const openWave = await getOpenWave();

    const results = await Promise.all(
      Array.from({ length: 10 }).map(() => finalizeWave(openWave.id, { kind: 'system' })),
    );

    const nonFinalized = results.filter((r) => !r.alreadyFinalized);
    const finalized = results.filter((r) => r.alreadyFinalized);

    expect(nonFinalized).toHaveLength(1);
    expect(finalized).toHaveLength(9);

    // Verify wave state in DB
    const waveRes = await pool.query<{ status: string }>(`SELECT status FROM waves WHERE id = $1`, [
      openWave.id,
    ]);
    expect(waveRes.rows[0]!.status).toBe('finalized');

    // Exactly one open wave exists with number = openWave.number + 1
    const openWaves = await pool.query<{ number: number }>(
      `SELECT number FROM waves WHERE status = 'open'`,
    );
    expect(openWaves.rows).toHaveLength(1);
    expect(openWaves.rows[0]!.number).toBe(openWave.number + 1);

    // Exactly 1 ledger row per user for that wave
    const userCount = (await pool.query(`SELECT count(*) FROM users`)).rows[0]!.count;
    const ledgerCount = (
      await pool.query(`SELECT count(*) FROM user_wave_reputation WHERE wave_id = $1`, [
        openWave.id,
      ])
    ).rows[0]!.count;
    expect(ledgerCount).toBe(userCount);
  });

  it('TEST-018: Bystanders and users created during open wave receive r = 0 rows and invariant I1 holds', async () => {
    const bystander = await createUser({
      username: 'bystander_user',
      email: 'bystander@example.com',
      password: 'password12345',
      displayName: 'Bystander',
      sigma: 0.6,
    });

    const openWave = await getOpenWave();
    await finalizeWave(openWave.id, { kind: 'system' });

    const ledger = await pool.query<{ r: number; n_pos: number; n_neg: number; n_adj: number }>(
      `SELECT r, n_pos, n_neg, n_adj FROM user_wave_reputation WHERE user_id = $1 AND wave_id = $2`,
      [bystander.id, openWave.id],
    );
    expect(ledger.rows).toHaveLength(1);
    expect(ledger.rows[0]!.r).toBe(0);
    expect(ledger.rows[0]!.n_pos).toBe(0);
    expect(ledger.rows[0]!.n_neg).toBe(0);
    expect(ledger.rows[0]!.n_adj).toBe(0);
  });

  it('TEST-019: Scores and history are preserved after pool close and recreate', async () => {
    const usersBefore = await pool.query(`SELECT id, username, q FROM users ORDER BY id`);
    const ledgerBefore = await pool.query(
      `SELECT user_id, wave_id, q_after FROM user_wave_reputation ORDER BY user_id, wave_id`,
    );

    // Close pool and get fresh pool
    await closeTestPool();
    const freshPool = getTestPool();

    const usersAfter = await freshPool.query(`SELECT id, username, q FROM users ORDER BY id`);
    const ledgerAfter = await freshPool.query(
      `SELECT user_id, wave_id, q_after FROM user_wave_reputation ORDER BY user_id, wave_id`,
    );

    expect(usersAfter.rows).toEqual(usersBefore.rows);
    expect(ledgerAfter.rows).toEqual(ledgerBefore.rows);

    pool = freshPool;
  });

  it('TEST-020: verifyScores passes (I1-I6) after multi-wave scenario with several users', async () => {
    const verifyResult = await verifyScores(pool);
    expect(verifyResult.issues).toEqual([]);
    expect(verifyResult.ok).toBe(true);
  });
});
