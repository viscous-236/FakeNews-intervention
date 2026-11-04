/**
 * apps/api/test/db/constraints.test.ts (TASK-017, TEST-103)
 *
 * Proves every database invariant:
 *   1. sigma immutability (users_guard_trg)
 *   2. q update blocked without app.scoring (users_guard_trg)
 *   3. single open wave (waves_one_open_uq)
 *   4. ledger CHECKs and immutability (ledger_guard_trg)
 *   5. counted event immutability (events_guard_trg)
 *   6. eligible event voiding and reactivation vs counted event voiding
 *   7. RESPONSIBLE_RESHARE (+1) and MISINFO_LIKE (-1) check constraints
 *   8. liking a reshare post fails via likes_target_original_trg
 *   9. review_queue_v includes auto_real with report; excludes admin-assessed post
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getTestPool, closeTestPool, truncateAll } from '../setup/db.js';
import { withTransaction } from '../../src/db/tx.js';
import { createUser } from '../../src/modules/users/service.js';

describe('Database Constraints & Invariants (TEST-103)', () => {
  beforeAll(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await closeTestPool();
  });

  it('1. sigma is immutable by trigger (users_guard_trg)', async () => {
    const user = await createUser({
      username: 'sigma_immut_user',
      email: 'sigma@example.com',
      password: 'validPassword123',
      displayName: 'Sigma User',
      sigma: 0.5,
    });

    const pool = getTestPool();
    await expect(
      pool.query(`UPDATE users SET sigma = 0.800 WHERE id = $1`, [user.id]),
    ).rejects.toThrow(/sigma is immutable/);
  });

  it('2. q update is blocked without app.scoring = on, and allowed with it', async () => {
    const user = await createUser({
      username: 'q_guard_user',
      email: 'qguard@example.com',
      password: 'validPassword123',
      displayName: 'Q Guard User',
      sigma: 0.5,
    });

    const pool = getTestPool();

    // Blocked outside scoring engine
    await expect(pool.query(`UPDATE users SET q = 5.000 WHERE id = $1`, [user.id])).rejects.toThrow(
      /q may only be changed by the scoring engine/,
    );

    // Allowed when app.scoring is on inside transaction
    await withTransaction(async (tx) => {
      await tx.query(`SET LOCAL app.scoring = 'on'`);
      await tx.query(`UPDATE users SET q = 5.000 WHERE id = $1`, [user.id]);
    });

    const res = await pool.query<{ q: string }>(`SELECT q FROM users WHERE id = $1`, [user.id]);
    expect(parseFloat(res.rows[0]!.q)).toBe(5.0);
  });

  it('3. single open wave enforced by partial unique index (waves_one_open_uq)', async () => {
    const pool = getTestPool();
    // Wave 1 is already open from truncateAll()
    await expect(
      pool.query(`INSERT INTO waves (number, status) VALUES (2, 'open')`),
    ).rejects.toThrow(/waves_one_open_uq|unique constraint/i);
  });

  it('4. ledger CHECKs and immutability (ledger_guard_trg)', async () => {
    const user = await createUser({
      username: 'ledger_user',
      email: 'ledger@example.com',
      password: 'validPassword123',
      displayName: 'Ledger User',
      sigma: 0.5,
    });

    const pool = getTestPool();
    const waveRes = await pool.query<{ id: string }>(`SELECT id FROM waves WHERE number = 1`);
    const waveId = waveRes.rows[0]!.id;

    // Direct insert without app.scoring fails
    await expect(
      pool.query(
        `INSERT INTO user_wave_reputation (
          user_id, wave_id, n_pos, n_neg, n_adj, r, sigma_used, q_before, delta, q_after, formula_version
        ) VALUES ($1, $2, 1, 0, 0, 1, 0.500, 0, 0.500, 0.500, 'paper-eq2-v1')`,
        [user.id, waveId],
      ),
    ).rejects.toThrow(/ledger rows may only be inserted by the scoring engine/);

    // Insert with invalid math violates CHECK constraint
    await expect(
      withTransaction(async (tx) => {
        await tx.query(`SET LOCAL app.scoring = 'on'`);
        await tx.query(
          `INSERT INTO user_wave_reputation (
            user_id, wave_id, n_pos, n_neg, n_adj, r, sigma_used, q_before, delta, q_after, formula_version
          ) VALUES ($1, $2, 1, 0, 0, 999, 0.500, 0, 0.500, 0.500, 'paper-eq2-v1')`,
          [user.id, waveId],
        );
      }),
    ).rejects.toThrow(/violates check constraint/);

    // Insert with valid math succeeds under app.scoring
    await withTransaction(async (tx) => {
      await tx.query(`SET LOCAL app.scoring = 'on'`);
      await tx.query(
        `INSERT INTO user_wave_reputation (
          user_id, wave_id, n_pos, n_neg, n_adj, r, sigma_used, q_before, delta, q_after, formula_version
        ) VALUES ($1, $2, 1, 0, 0, 1, 0.500, 0, 0.500, 0.500, 'paper-eq2-v1')`,
        [user.id, waveId],
      );
    });

    // Attempting to UPDATE or DELETE ledger row fails
    await expect(
      pool.query(`UPDATE user_wave_reputation SET delta = 1 WHERE user_id = $1 AND wave_id = $2`, [
        user.id,
        waveId,
      ]),
    ).rejects.toThrow(/user_wave_reputation is immutable/);

    await expect(
      pool.query(`DELETE FROM user_wave_reputation WHERE user_id = $1 AND wave_id = $2`, [
        user.id,
        waveId,
      ]),
    ).rejects.toThrow(/user_wave_reputation is immutable/);
  });

  it('5 & 6. event voiding, reactivation, and counted event immutability', async () => {
    const user = await createUser({
      username: 'event_user',
      email: 'event@example.com',
      password: 'validPassword123',
      displayName: 'Event User',
      sigma: 0.5,
    });

    const pool = getTestPool();
    const waveRes = await pool.query<{ id: string }>(`SELECT id FROM waves WHERE number = 1`);
    const waveId = waveRes.rows[0]!.id;

    // Create post & assessment
    const postRes = await pool.query<{ id: string }>(
      `INSERT INTO posts (author_id, kind, body, author_tier_at_post)
       VALUES ($1, 'original', 'This is a test post that is at least twenty characters long.', 'neutral')
       RETURNING id`,
      [user.id],
    );
    const postId = postRes.rows[0]!.id;

    const assessRes = await pool.query<{ id: string }>(
      `INSERT INTO assessments (post_id, post_revision, verdict, source, decided_by, rationale)
       VALUES ($1, 1, 'real', 'admin', $2, 'Verified by reputable fact check.')
       RETURNING id`,
      [postId, user.id],
    );
    const assessmentId = assessRes.rows[0]!.id;

    // Insert eligible event
    const eventRes = await pool.query<{ id: string }>(
      `INSERT INTO reputation_events (
        user_id, post_id, assessment_id, kind, value, status, wave_id
      ) VALUES ($1, $2, $3, 'RESPONSIBLE_POST', 1, 'eligible', $4)
      RETURNING id`,
      [user.id, postId, assessmentId, waveId],
    );
    const eventId = eventRes.rows[0]!.id;

    // Voiding eligible event with interaction_retracted succeeds
    await pool.query(
      `UPDATE reputation_events
       SET status = 'voided', void_reason = 'interaction_retracted', wave_id = NULL
       WHERE id = $1`,
      [eventId],
    );

    const voided = await pool.query<{ status: string; void_reason: string }>(
      `SELECT status, void_reason FROM reputation_events WHERE id = $1`,
      [eventId],
    );
    expect(voided.rows[0]!.status).toBe('voided');
    expect(voided.rows[0]!.void_reason).toBe('interaction_retracted');

    // Reactivation back to eligible succeeds
    await pool.query(
      `UPDATE reputation_events
       SET status = 'eligible', void_reason = NULL, wave_id = $2
       WHERE id = $1`,
      [eventId, waveId],
    );

    // Make event counted (requires app.scoring and user_wave_reputation entry)
    await withTransaction(async (tx) => {
      await tx.query(`SET LOCAL app.scoring = 'on'`);
      await tx.query(
        `INSERT INTO user_wave_reputation (
          user_id, wave_id, n_pos, n_neg, n_adj, r, sigma_used, q_before, delta, q_after, formula_version
        ) VALUES ($1, $2, 1, 0, 0, 1, 0.500, 0, 0.500, 0.500, 'paper-eq2-v1')
        ON CONFLICT (user_id, wave_id) DO NOTHING`,
        [user.id, waveId],
      );
      await tx.query(
        `UPDATE reputation_events
         SET status = 'counted', ledger_user_id = $2, ledger_wave_id = $3
         WHERE id = $1`,
        [eventId, user.id, waveId],
      );
    });

    // Now counted: modifying or voiding must fail
    await expect(
      pool.query(
        `UPDATE reputation_events SET status = 'voided', void_reason = 'interaction_retracted', wave_id = NULL WHERE id = $1`,
        [eventId],
      ),
    ).rejects.toThrow(/counted events are immutable/);

    // Deleting must fail
    await expect(
      pool.query(`DELETE FROM reputation_events WHERE id = $1`, [eventId]),
    ).rejects.toThrow(/reputation_events are never deleted/);
  });

  it('7. RESPONSIBLE_RESHARE requires value = 1, MISINFO_LIKE requires value = -1', async () => {
    const user = await createUser({
      username: 'check_kind_user',
      email: 'checkkind@example.com',
      password: 'validPassword123',
      displayName: 'Check Kind User',
      sigma: 0.5,
    });

    const pool = getTestPool();
    const waveRes = await pool.query<{ id: string }>(`SELECT id FROM waves WHERE number = 1`);
    const waveId = waveRes.rows[0]!.id;

    const postRes = await pool.query<{ id: string }>(
      `INSERT INTO posts (author_id, kind, body, author_tier_at_post)
       VALUES ($1, 'original', 'Another post that easily satisfies length.', 'neutral')
       RETURNING id`,
      [user.id],
    );
    const postId = postRes.rows[0]!.id;

    const assessRes = await pool.query<{ id: string }>(
      `INSERT INTO assessments (post_id, post_revision, verdict, source, decided_by, rationale)
       VALUES ($1, 1, 'real', 'admin', $2, 'Verified rationale here.')
       RETURNING id`,
      [postId, user.id],
    );
    const assessmentId = assessRes.rows[0]!.id;

    // RESPONSIBLE_RESHARE with value = -1 violates CHECK
    await expect(
      pool.query(
        `INSERT INTO reputation_events (user_id, post_id, assessment_id, kind, value, status, wave_id)
         VALUES ($1, $2, $3, 'RESPONSIBLE_RESHARE', -1, 'eligible', $4)`,
        [user.id, postId, assessmentId, waveId],
      ),
    ).rejects.toThrow(/violates check constraint/);

    // MISINFO_LIKE with value = 1 violates CHECK
    await expect(
      pool.query(
        `INSERT INTO reputation_events (user_id, post_id, assessment_id, kind, value, status, wave_id)
         VALUES ($1, $2, $3, 'MISINFO_LIKE', 1, 'eligible', $4)`,
        [user.id, postId, assessmentId, waveId],
      ),
    ).rejects.toThrow(/violates check constraint/);

    // Proper values succeed
    await pool.query(
      `INSERT INTO reputation_events (user_id, post_id, assessment_id, kind, value, status, wave_id)
       VALUES ($1, $2, $3, 'RESPONSIBLE_RESHARE', 1, 'eligible', $4)`,
      [user.id, postId, assessmentId, waveId],
    );

    await pool.query(
      `INSERT INTO reputation_events (user_id, post_id, assessment_id, kind, value, status, wave_id)
       VALUES ($1, $2, $3, 'MISINFO_LIKE', -1, 'eligible', $4)`,
      [user.id, postId, assessmentId, waveId],
    );
  });

  it('8. liking a reshare post fails via likes_target_original_trg', async () => {
    const user1 = await createUser({
      username: 'author_user',
      email: 'author@example.com',
      password: 'validPassword123',
      displayName: 'Author User',
      sigma: 0.5,
    });

    const user2 = await createUser({
      username: 'resharer_user',
      email: 'resharer@example.com',
      password: 'validPassword123',
      displayName: 'Resharer User',
      sigma: 0.5,
    });

    const pool = getTestPool();

    // Original post
    const origPost = await pool.query<{ id: string }>(
      `INSERT INTO posts (author_id, kind, body, author_tier_at_post)
       VALUES ($1, 'original', 'Original post content that is long enough.', 'neutral')
       RETURNING id`,
      [user1.id],
    );
    const origId = origPost.rows[0]!.id;

    // Reshare post
    const resharePost = await pool.query<{ id: string }>(
      `INSERT INTO posts (author_id, kind, reshare_of_post_id, author_tier_at_post)
       VALUES ($1, 'reshare', $2, 'neutral')
       RETURNING id`,
      [user2.id, origId],
    );
    const reshareId = resharePost.rows[0]!.id;

    // Liking original post succeeds
    await pool.query(`INSERT INTO likes (user_id, post_id) VALUES ($1, $2)`, [user2.id, origId]);

    // Liking reshare post fails with check_violation
    await expect(
      pool.query(`INSERT INTO likes (user_id, post_id) VALUES ($1, $2)`, [user1.id, reshareId]),
    ).rejects.toThrow(/like target must be an original post/);
  });

  it('9. review_queue_v admits auto_real with open report, excludes admin-assessed post', async () => {
    const user = await createUser({
      username: 'queue_user',
      email: 'queue@example.com',
      password: 'validPassword123',
      displayName: 'Queue User',
      sigma: 0.5,
    });

    const pool = getTestPool();

    // 1. Post with auto_real assessment and NO open reports
    const post1 = await pool.query<{ id: string }>(
      `INSERT INTO posts (author_id, kind, body, author_tier_at_post)
       VALUES ($1, 'original', 'Post one with auto_real assessment.', 'neutral')
       RETURNING id`,
      [user.id],
    );
    const post1Id = post1.rows[0]!.id;

    await pool.query(
      `INSERT INTO assessments (post_id, post_revision, verdict, source, decided_by, rationale)
       VALUES ($1, 1, 'real', 'auto_real', NULL, 'Low risk automatic assessment.')`,
      [post1Id],
    );

    // Initially post 1 is NOT in queue
    let qRes = await pool.query<{ post_id: string }>(
      `SELECT post_id FROM review_queue_v WHERE post_id = $1`,
      [post1Id],
    );
    expect(qRes.rows).toHaveLength(0);

    // Add open report to post 1
    await pool.query(
      `INSERT INTO reports (post_id, reporter_id, reason, details)
       VALUES ($1, $2, 'false_information', 'This was falsely marked auto_real.')`,
      [post1Id, user.id],
    );

    // Post 1 is NOW in review_queue_v! (Audit Gap 4 resolution)
    qRes = await pool.query<{ post_id: string }>(
      `SELECT post_id FROM review_queue_v WHERE post_id = $1`,
      [post1Id],
    );
    expect(qRes.rows).toHaveLength(1);

    // 2. Post with admin assessment and an open report is NOT in review_queue_v
    const post2 = await pool.query<{ id: string }>(
      `INSERT INTO posts (author_id, kind, body, author_tier_at_post)
       VALUES ($1, 'original', 'Post two with admin assessment.', 'neutral')
       RETURNING id`,
      [user.id],
    );
    const post2Id = post2.rows[0]!.id;

    await pool.query(
      `INSERT INTO assessments (post_id, post_revision, verdict, source, decided_by, rationale)
       VALUES ($1, 1, 'real', 'admin', $2, 'Human fact-checked review.')`,
      [post2Id, user.id],
    );

    await pool.query(
      `INSERT INTO reports (post_id, reporter_id, reason, details)
       VALUES ($1, $2, 'false_information', 'User reporting admin post.')`,
      [post2Id, user.id],
    );

    // Post 2 is NOT in review_queue_v because admin verdict exists
    const qRes2 = await pool.query<{ post_id: string }>(
      `SELECT post_id FROM review_queue_v WHERE post_id = $1`,
      [post2Id],
    );
    expect(qRes2.rows).toHaveLength(0);
  });
});
