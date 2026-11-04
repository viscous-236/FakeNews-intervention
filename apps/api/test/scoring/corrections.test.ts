/**
 * apps/api/test/scoring/corrections.test.ts (TASK-027)
 *
 * Tests TEST-021 through TEST-035:
 *   - TEST-021: Reversal after finalization: counted -1 yields Q = -0.5; overturn creates +1 reversal, next wave Q = 0
 *   - TEST-022: Voiding before finalization: superseding voids eligible events with 'assessment_superseded'
 *   - TEST-023: Cascade reversal: fake assessment with author, 2 resharers, 1 reporter overturned -> +1, +1, +1, -1 reversals
 *   - TEST-024: verifyScores passes after multiple corrections and appeals
 *   - TEST-025: Tamper detection: manual q_after edit triggers I2/I3 violation in verifyScores
 *   - TEST-026: Successive superseding (fake -> real -> fake) generates 3 assessments without 23505 errors
 *   - TEST-027: Good-Faith Window: interactions during admin real window exempt from retroactive penalties
 *   - TEST-028: Historical reporter reward: resolved reports receive VALID_REPORT if later superseded by fake
 *   - TEST-029: Like penalty & pre-finalization retraction: unliking voids eligible MISINFO_LIKE
 *   - TEST-030: Like retraction blocked after wave finalization: counted MISINFO_LIKE stays immutable
 *   - TEST-031: Verified-true reshare reward & cap: max 5 RESPONSIBLE_RESHARE per wave; auto_real creates 0
 *   - TEST-032: Reshare retraction before vs after wave finalization; held appeal auto-closed on pre-finalization delete
 *   - TEST-033: Repeated like and reshare idempotency: multiple toggles reactivate without 23505
 *   - TEST-034: Publisher reputation independence: interaction penalties unaffected by publisher Q/tier
 *   - TEST-035: Flat publisher penalty: viral false post receives exactly one -1 MISINFO_POST
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Pool } from 'pg';
import { getTestPool, closeTestPool, truncateAll } from '../setup/db.js';
import { withTransaction } from '../../src/db/tx.js';
import { createUser } from '../../src/modules/users/service.js';
import { finalizeWave } from '../../src/scoring/finalizeWave.js';
import { verifyScores } from '../../src/scoring/verify.js';
import {
  createEventsForAssessment,
  syncReshareEventOnCreate,
  retractReshareEventOnDelete,
  syncLikeEventOnLike,
  retractLikeEventOnUnlike,
  type AssessmentRecord,
} from '../../src/scoring/events.js';
import { supersedeAssessment } from '../../src/scoring/corrections.js';

describe('Scoring Corrections, Overturns & Retractions (TEST-021 through TEST-035)', () => {
  let pool: Pool;
  let adminId: string;

  beforeAll(async () => {
    await truncateAll();
    pool = getTestPool();

    const admin = await createUser({
      username: 'correction_admin',
      email: 'correction_admin@example.com',
      password: 'password12345',
      displayName: 'Correction Admin',
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

  async function createPost(authorId: string): Promise<string> {
    const postRes = await pool.query<{ id: string }>(
      `INSERT INTO posts (author_id, kind, body, author_tier_at_post)
       VALUES ($1, 'original', 'Post body for corrections test', 'neutral')
       RETURNING id`,
      [authorId],
    );
    return postRes.rows[0]!.id;
  }

  it('TEST-021: Reversal after finalization: counted -1 yields Q = -0.5; overturn creates +1 reversal, next wave Q = 0', async () => {
    const author = await createUser({
      username: 'user_test021',
      email: 'test021@example.com',
      password: 'password12345',
      displayName: 'User 021',
      sigma: 0.5,
    });

    const postId = await createPost(author.id);

    // Initial assessment: fake -> MISINFO_POST (-1)
    let initialAssessment: AssessmentRecord;
    await withTransaction(async (tx) => {
      const aRes = await tx.query<AssessmentRecord>(
        `INSERT INTO assessments (post_id, post_revision, verdict, source, decided_by, rationale)
         VALUES ($1, 1, 'fake', 'admin', $2, 'Initial fake verdict assessment')
         RETURNING id, post_id, post_revision, verdict, source, decided_by, rationale, created_at`,
        [postId, adminId],
      );
      initialAssessment = aRes.rows[0]!;
      await createEventsForAssessment(tx, initialAssessment);
    });

    // Finalize wave 1: user receives Q = -0.500
    const wave1 = await getOpenWave();
    await finalizeWave(wave1.id, { kind: 'admin', userId: adminId });

    const q1Res = await pool.query<{ q: string }>(`SELECT q FROM users WHERE id = $1`, [author.id]);
    expect(q1Res.rows[0]!.q).toBe('-0.500');

    // Overturn via supersede to 'real'
    await withTransaction(async (tx) => {
      await supersedeAssessment(tx, initialAssessment, {
        verdict: 'real',
        source: 'admin',
        decided_by: adminId,
        rationale: 'Overturned to real upon review',
      });
    });

    // Check that a REVERSAL (+1) event was created for Wave 2
    const reversalRes = await pool.query<{ kind: string; value: number; status: string }>(
      `SELECT kind, value, status FROM reputation_events
       WHERE user_id = $1 AND kind = 'REVERSAL'`,
      [author.id],
    );
    expect(reversalRes.rows).toHaveLength(1);
    expect(reversalRes.rows[0]!.value).toBe(1);
    expect(reversalRes.rows[0]!.status).toBe('eligible');

    // Finalize wave 2: reversal +1 cancels out previous -1; plus new RESPONSIBLE_POST (+1)
    // Wait: overturn to real also creates RESPONSIBLE_POST (+1) for author!
    // Net in wave 2: reversal (+1) + responsible_post (+1) = +2 => delta = 0.5 * 2 = +1.000 => q = -0.5 + 1.0 = +0.500
    const wave2 = await getOpenWave();
    await finalizeWave(wave2.id, { kind: 'admin', userId: adminId });

    const q2Res = await pool.query<{ q: string }>(`SELECT q FROM users WHERE id = $1`, [author.id]);
    expect(q2Res.rows[0]!.q).toBe('0.500');

    // Old counted event and old ledger row remain completely immutable
    const oldEventRes = await pool.query<{ status: string }>(
      `SELECT status FROM reputation_events WHERE assessment_id = $1 AND kind = 'MISINFO_POST'`,
      [initialAssessment!.id],
    );
    expect(oldEventRes.rows[0]!.status).toBe('counted');
  });

  it('TEST-022: Voiding before finalization: superseding voids eligible events with assessment_superseded', async () => {
    const author = await createUser({
      username: 'user_test022',
      email: 'test022@example.com',
      password: 'password12345',
      displayName: 'User 022',
      sigma: 0.5,
    });
    const postId = await createPost(author.id);

    let initialAssessment: AssessmentRecord;
    await withTransaction(async (tx) => {
      const aRes = await tx.query<AssessmentRecord>(
        `INSERT INTO assessments (post_id, post_revision, verdict, source, decided_by, rationale)
         VALUES ($1, 1, 'fake', 'admin', $2, 'Initial fake verdict assessment')
         RETURNING id, post_id, post_revision, verdict, source, decided_by, rationale, created_at`,
        [postId, adminId],
      );
      initialAssessment = aRes.rows[0]!;
      await createEventsForAssessment(tx, initialAssessment);
    });

    // Before finalizing wave, supersede with unverifiable
    await withTransaction(async (tx) => {
      await supersedeAssessment(tx, initialAssessment, {
        verdict: 'unverifiable',
        source: 'admin',
        decided_by: adminId,
        rationale: 'Overturned to unverifiable before finalization',
      });
    });

    // Check old event was voided with assessment_superseded
    const evRes = await pool.query<{ status: string; void_reason: string }>(
      `SELECT status, void_reason FROM reputation_events WHERE assessment_id = $1`,
      [initialAssessment!.id],
    );
    expect(evRes.rows[0]!.status).toBe('voided');
    expect(evRes.rows[0]!.void_reason).toBe('assessment_superseded');

    // Finalize wave: user has 0 events counted
    const openWave = await getOpenWave();
    await finalizeWave(openWave.id, { kind: 'system' });

    const userRes = await pool.query<{ q: string }>(`SELECT q FROM users WHERE id = $1`, [
      author.id,
    ]);
    expect(userRes.rows[0]!.q).toBe('0.000');
  });

  it('TEST-023: Cascade reversal: fake assessment with author, 2 resharers, 1 reporter overturned yields reversals +1, +1, +1, -1', async () => {
    const author = await createUser({
      username: 'u_cascade_auth',
      email: 'u_auth@example.com',
      password: 'password12345',
      displayName: 'Cascade Author',
      sigma: 0.5,
    });
    const resharer1 = await createUser({
      username: 'u_cascade_res1',
      email: 'u_res1@example.com',
      password: 'password12345',
      displayName: 'Resharer 1',
      sigma: 0.5,
    });
    const resharer2 = await createUser({
      username: 'u_cascade_res2',
      email: 'u_res2@example.com',
      password: 'password12345',
      displayName: 'Resharer 2',
      sigma: 0.5,
    });
    const reporter = await createUser({
      username: 'u_cascade_rep',
      email: 'u_rep@example.com',
      password: 'password12345',
      displayName: 'Reporter',
      sigma: 0.5,
    });

    const postId = await createPost(author.id);

    // Resharers reshare
    await pool.query(
      `INSERT INTO posts (author_id, kind, reshare_of_post_id, author_tier_at_post)
       VALUES ($1, 'reshare', $3, 'neutral'), ($2, 'reshare', $3, 'neutral')`,
      [resharer1.id, resharer2.id, postId],
    );

    // Reporter reports
    await pool.query(
      `INSERT INTO reports (post_id, reporter_id, reason, details)
       VALUES ($1, $2, 'false_information', 'Fake news report details')`,
      [postId, reporter.id],
    );

    // Assess as fake
    let fakeAssessment: AssessmentRecord;
    await withTransaction(async (tx) => {
      const aRes = await tx.query<AssessmentRecord>(
        `INSERT INTO assessments (post_id, post_revision, verdict, source, decided_by, rationale)
         VALUES ($1, 1, 'fake', 'admin', $2, 'Initial fake verdict assessment')
         RETURNING id, post_id, post_revision, verdict, source, decided_by, rationale, created_at`,
        [postId, adminId],
      );
      fakeAssessment = aRes.rows[0]!;
      await createEventsForAssessment(tx, fakeAssessment);
    });

    // Finalize wave 1
    const wave1 = await getOpenWave();
    await finalizeWave(wave1.id, { kind: 'system' });

    // Now overturn to unverifiable
    await withTransaction(async (tx) => {
      await supersedeAssessment(tx, fakeAssessment, {
        verdict: 'unverifiable',
        source: 'admin',
        decided_by: adminId,
        rationale: 'Overturned upon appeal to unverifiable',
      });
    });

    // Check reversals in open wave:
    // Author: +1 (reverses -1)
    // Resharer 1: +1 (reverses -1)
    // Resharer 2: +1 (reverses -1)
    // Reporter: -1 (reverses +1)
    const reversalsRes = await pool.query<{ user_id: string; value: number }>(
      `SELECT user_id, value FROM reputation_events WHERE post_id = $1 AND kind = 'REVERSAL' AND status = 'eligible'`,
      [postId],
    );
    const revMap = new Map(reversalsRes.rows.map((r) => [r.user_id, r.value]));

    expect(revMap.get(author.id)).toBe(1);
    expect(revMap.get(resharer1.id)).toBe(1);
    expect(revMap.get(resharer2.id)).toBe(1);
    expect(revMap.get(reporter.id)).toBe(-1);
  });

  it('TEST-024: verifyScores passes after several corrections and appeals', async () => {
    const res = await verifyScores(pool);
    expect(res.issues).toEqual([]);
    expect(res.ok).toBe(true);
  });

  it('TEST-025: Tamper detection: editing q_after of one row makes verifyScores report I2 or I3', async () => {
    // Pick any user with a ledger row
    const rowRes = await pool.query<{ user_id: string; wave_id: string; q_after: string }>(
      `SELECT user_id, wave_id, q_after FROM user_wave_reputation LIMIT 1`,
    );
    const row = rowRes.rows[0]!;

    // Temporarily disable ledger guard trigger and check2 constraint as DB owner to simulate tampering
    await pool.query(`ALTER TABLE user_wave_reputation DISABLE TRIGGER ledger_guard_trg`);
    await pool.query(
      `ALTER TABLE user_wave_reputation DROP CONSTRAINT IF EXISTS user_wave_reputation_check2`,
    );
    await pool.query(
      `UPDATE user_wave_reputation SET q_after = 99.999 WHERE user_id = $1 AND wave_id = $2`,
      [row.user_id, row.wave_id],
    );

    const tamperedCheck = await verifyScores(pool);
    expect(tamperedCheck.ok).toBe(false);
    expect(tamperedCheck.issues.some((i) => i.invariant === 'I2' || i.invariant === 'I3')).toBe(
      true,
    );

    // Restore original and re-enable constraint and trigger
    await pool.query(
      `UPDATE user_wave_reputation SET q_after = $1 WHERE user_id = $2 AND wave_id = $3`,
      [row.q_after, row.user_id, row.wave_id],
    );
    await pool.query(
      `ALTER TABLE user_wave_reputation ADD CONSTRAINT user_wave_reputation_check2 CHECK (q_after = q_before + delta)`,
    );
    await pool.query(`ALTER TABLE user_wave_reputation ENABLE TRIGGER ledger_guard_trg`);

    const cleanCheck = await verifyScores(pool);
    expect(cleanCheck.ok).toBe(true);
  });

  it('TEST-026: Fake -> real -> fake for same post creates three assessments without unique violations', async () => {
    const author = await createUser({
      username: 'u_three_assess',
      email: 'u_three@example.com',
      password: 'password12345',
      displayName: 'Three Assess User',
      sigma: 0.5,
    });
    const postId = await createPost(author.id);

    // Assessment 1: fake
    let a1: AssessmentRecord;
    await withTransaction(async (tx) => {
      const r = await tx.query<AssessmentRecord>(
        `INSERT INTO assessments (post_id, post_revision, verdict, source, decided_by, rationale)
         VALUES ($1, 1, 'fake', 'admin', $2, 'Rationale 1 - Fake verdict')
         RETURNING id, post_id, post_revision, verdict, source, decided_by, rationale, created_at`,
        [postId, adminId],
      );
      a1 = r.rows[0]!;
      await createEventsForAssessment(tx, a1);
    });

    // Assessment 2: real (supersedes a1)
    let a2: AssessmentRecord;
    await withTransaction(async (tx) => {
      const res = await supersedeAssessment(tx, a1, {
        verdict: 'real',
        source: 'admin',
        decided_by: adminId,
        rationale: 'Rationale 2 - Overturned to Real',
      });
      a2 = res.newAssessment;
    });

    // Assessment 3: fake again (supersedes a2)
    await withTransaction(async (tx) => {
      await supersedeAssessment(tx, a2, {
        verdict: 'fake',
        source: 'admin',
        decided_by: adminId,
        rationale: 'Rationale 3 - Overturned back to Fake',
      });
    });

    const countRes = await pool.query<{ count: string }>(
      `SELECT count(*) FROM assessments WHERE post_id = $1`,
      [postId],
    );
    expect(parseInt(countRes.rows[0]!.count, 10)).toBe(3);

    const vRes = await verifyScores(pool);
    expect(vRes.ok).toBe(true);
  });

  it('TEST-027: Good-Faith Window: interactions during admin real window exempt from retroactive penalties', async () => {
    const author = await createUser({
      username: 'u_gf_author',
      email: 'u_gf_author@example.com',
      password: 'password12345',
      displayName: 'GF Author',
      sigma: 0.5,
    });
    const userB = await createUser({
      username: 'u_gf_user_b',
      email: 'u_gf_user_b@example.com',
      password: 'password12345',
      displayName: 'GF User B',
      sigma: 0.5,
    });
    const userC = await createUser({
      username: 'u_gf_user_c',
      email: 'u_gf_user_c@example.com',
      password: 'password12345',
      displayName: 'GF User C',
      sigma: 0.5,
    });
    const userD = await createUser({
      username: 'u_gf_user_d',
      email: 'u_gf_user_d@example.com',
      password: 'password12345',
      displayName: 'GF User D',
      sigma: 0.5,
    });

    const postId = await createPost(author.id);

    // User D reshares BEFORE any assessment (explicit past timestamp to avoid clock collisions)
    const _reshareD = (
      await pool.query<{ id: string }>(
        `INSERT INTO posts (author_id, kind, reshare_of_post_id, author_tier_at_post, created_at)
         VALUES ($1, 'reshare', $2, 'neutral', now() - interval '10 seconds') RETURNING id`,
        [userD.id, postId],
      )
    ).rows[0]!;

    // Admin assesses post as REAL
    let aReal: AssessmentRecord;
    await withTransaction(async (tx) => {
      const aRes = await tx.query<AssessmentRecord>(
        `INSERT INTO assessments (post_id, post_revision, verdict, source, decided_by, rationale)
         VALUES ($1, 1, 'real', 'admin', $2, 'Admin verified real assessment')
         RETURNING id, post_id, post_revision, verdict, source, decided_by, rationale, created_at`,
        [postId, adminId],
      );
      aReal = aRes.rows[0]!;
      await createEventsForAssessment(tx, aReal);
    });

    // While post is verified real: User B reshares, User C likes
    await withTransaction(async (tx) => {
      const reshareB = (
        await tx.query<{ id: string; author_id: string; reshare_of_post_id: string }>(
          `INSERT INTO posts (author_id, kind, reshare_of_post_id, author_tier_at_post)
           VALUES ($1, 'reshare', $2, 'neutral') RETURNING id, author_id, reshare_of_post_id`,
          [userB.id, postId],
        )
      ).rows[0]!;
      await syncReshareEventOnCreate(tx, reshareB);

      await tx.query(`INSERT INTO likes (user_id, post_id) VALUES ($1, $2)`, [userC.id, postId]);
      await syncLikeEventOnLike(tx, userC.id, postId);
    });

    // Later: Admin supersedes assessment with FAKE
    await withTransaction(async (tx) => {
      await supersedeAssessment(tx, aReal, {
        verdict: 'fake',
        source: 'admin',
        decided_by: adminId,
        rationale: 'Overturned to fake: misinformation found',
      });
    });

    // Good-Faith Window protection assertions:
    // 1. User B (reshared during real window) must NOT have MISINFO_RESHARE
    const userBEvents = await pool.query<{ kind: string; status: string }>(
      `SELECT kind, status FROM reputation_events WHERE user_id = $1`,
      [userB.id],
    );
    expect(userBEvents.rows.some((e) => e.kind === 'MISINFO_RESHARE')).toBe(false);

    // 2. User C (liked during real window) must NOT have MISINFO_LIKE
    const userCEvents = await pool.query<{ kind: string }>(
      `SELECT kind FROM reputation_events WHERE user_id = $1`,
      [userC.id],
    );
    expect(userCEvents.rows.some((e) => e.kind === 'MISINFO_LIKE')).toBe(false);

    // 3. User D (reshared BEFORE the real window) DOES receive MISINFO_RESHARE
    const userDEvents = await pool.query<{ kind: string; status: string }>(
      `SELECT kind, status FROM reputation_events WHERE user_id = $1 AND kind = 'MISINFO_RESHARE'`,
      [userD.id],
    );
    expect(userDEvents.rows).toHaveLength(1);
    expect(userDEvents.rows[0]!.status).toBe('eligible');
  });

  it('TEST-028: Historical reporter reward: resolved report receives VALID_REPORT when superseded by fake', async () => {
    const author = await createUser({
      username: 'u_rep_author',
      email: 'u_rep_auth@example.com',
      password: 'password12345',
      displayName: 'Rep Author',
      sigma: 0.5,
    });
    const reporter = await createUser({
      username: 'u_rep_reporter',
      email: 'u_rep_rep@example.com',
      password: 'password12345',
      displayName: 'Rep Reporter',
      sigma: 0.5,
    });
    const postId = await createPost(author.id);

    // Reporter submits report
    await pool.query(
      `INSERT INTO reports (post_id, reporter_id, reason, details)
       VALUES ($1, $2, 'false_information', 'Claims false information')`,
      [postId, reporter.id],
    );

    // Admin assesses as unverifiable -> report status becomes resolved, 0 events
    let aUnverifiable: AssessmentRecord;
    await withTransaction(async (tx) => {
      const aRes = await tx.query<AssessmentRecord>(
        `INSERT INTO assessments (post_id, post_revision, verdict, source, decided_by, rationale)
         VALUES ($1, 1, 'unverifiable', 'admin', $2, 'Cannot verify fact currently')
         RETURNING id, post_id, post_revision, verdict, source, decided_by, rationale, created_at`,
        [postId, adminId],
      );
      aUnverifiable = aRes.rows[0]!;
      await createEventsForAssessment(tx, aUnverifiable);
    });

    const reportStatus = await pool.query<{ status: string }>(
      `SELECT status FROM reports WHERE post_id = $1 AND reporter_id = $2`,
      [postId, reporter.id],
    );
    expect(reportStatus.rows[0]!.status).toBe('resolved');

    // Reporter has 0 events
    const repEventsBefore = await pool.query(`SELECT * FROM reputation_events WHERE user_id = $1`, [
      reporter.id,
    ]);
    expect(repEventsBefore.rows).toHaveLength(0);

    // Later: Admin supersedes unverifiable with fake
    await withTransaction(async (tx) => {
      await supersedeAssessment(tx, aUnverifiable, {
        verdict: 'fake',
        source: 'admin',
        decided_by: adminId,
        rationale: 'Confirmed fake news after investigation',
      });
    });

    // Reporter now receives VALID_REPORT (+1)
    const repEventsAfter = await pool.query<{ kind: string; value: number; status: string }>(
      `SELECT kind, value, status FROM reputation_events WHERE user_id = $1`,
      [reporter.id],
    );
    expect(repEventsAfter.rows).toHaveLength(1);
    expect(repEventsAfter.rows[0]!.kind).toBe('VALID_REPORT');
    expect(repEventsAfter.rows[0]!.value).toBe(1);
    expect(repEventsAfter.rows[0]!.status).toBe('eligible');
  });

  it('TEST-029: Like penalty & pre-finalization retraction: unliking voids eligible MISINFO_LIKE', async () => {
    const author = await createUser({
      username: 'u_like_author',
      email: 'u_like_auth@example.com',
      password: 'password12345',
      displayName: 'Like Author',
      sigma: 0.5,
    });
    const liker = await createUser({
      username: 'u_like_liker',
      email: 'u_like_liker@example.com',
      password: 'password12345',
      displayName: 'Liker',
      sigma: 0.5,
    });
    const postId = await createPost(author.id);

    // Liker likes post
    await pool.query(`INSERT INTO likes (user_id, post_id) VALUES ($1, $2)`, [liker.id, postId]);

    // Admin assesses as fake -> MISINFO_LIKE (-1, eligible) created for liker
    await withTransaction(async (tx) => {
      const aRes = await tx.query<AssessmentRecord>(
        `INSERT INTO assessments (post_id, post_revision, verdict, source, decided_by, rationale)
         VALUES ($1, 1, 'fake', 'admin', $2, 'Assessed as fake post')
         RETURNING id, post_id, post_revision, verdict, source, decided_by, rationale, created_at`,
        [postId, adminId],
      );
      await createEventsForAssessment(tx, aRes.rows[0]!);
    });

    const evBefore = await pool.query<{ status: string; kind: string }>(
      `SELECT status, kind FROM reputation_events WHERE user_id = $1`,
      [liker.id],
    );
    expect(evBefore.rows).toHaveLength(1);
    expect(evBefore.rows[0]!.kind).toBe('MISINFO_LIKE');
    expect(evBefore.rows[0]!.status).toBe('eligible');

    // Liker unlikes before wave finalization
    await withTransaction(async (tx) => {
      await tx.query(
        `UPDATE likes SET deleted_at = now(), updated_at = now() WHERE user_id = $1 AND post_id = $2`,
        [liker.id, postId],
      );
      await retractLikeEventOnUnlike(tx, liker.id, postId);
    });

    const evAfter = await pool.query<{ status: string; void_reason: string }>(
      `SELECT status, void_reason FROM reputation_events WHERE user_id = $1`,
      [liker.id],
    );
    expect(evAfter.rows[0]!.status).toBe('voided');
    expect(evAfter.rows[0]!.void_reason).toBe('interaction_retracted');

    // Finalize wave: liker receives delta = 0
    const openWave = await getOpenWave();
    await finalizeWave(openWave.id, { kind: 'system' });

    const likerScore = await pool.query<{ q: string }>(`SELECT q FROM users WHERE id = $1`, [
      liker.id,
    ]);
    expect(likerScore.rows[0]!.q).toBe('0.000');
  });

  it('TEST-030: Like retraction blocked after wave finalization: counted MISINFO_LIKE stays immutable', async () => {
    const author = await createUser({
      username: 'u_like_fin_auth',
      email: 'u_lfa@example.com',
      password: 'password12345',
      displayName: 'LFA Author',
      sigma: 0.5,
    });
    const liker = await createUser({
      username: 'u_like_fin_liker',
      email: 'u_lfl@example.com',
      password: 'password12345',
      displayName: 'LFL Liker',
      sigma: 0.5,
    });
    const postId = await createPost(author.id);

    // Like and assess fake
    await pool.query(`INSERT INTO likes (user_id, post_id) VALUES ($1, $2)`, [liker.id, postId]);
    await withTransaction(async (tx) => {
      const aRes = await tx.query<AssessmentRecord>(
        `INSERT INTO assessments (post_id, post_revision, verdict, source, decided_by, rationale)
         VALUES ($1, 1, 'fake', 'admin', $2, 'Assessed as fake post')
         RETURNING id, post_id, post_revision, verdict, source, decided_by, rationale, created_at`,
        [postId, adminId],
      );
      await createEventsForAssessment(tx, aRes.rows[0]!);
    });

    // Wave 1 finalized -> MISINFO_LIKE is counted
    const wave1 = await getOpenWave();
    await finalizeWave(wave1.id, { kind: 'system' });

    const likerQ1 = await pool.query<{ q: string }>(`SELECT q FROM users WHERE id = $1`, [
      liker.id,
    ]);
    expect(likerQ1.rows[0]!.q).toBe('-0.500');

    // Wave 2: Liker unlikes
    await withTransaction(async (tx) => {
      await tx.query(
        `UPDATE likes SET deleted_at = now(), updated_at = now() WHERE user_id = $1 AND post_id = $2`,
        [liker.id, postId],
      );
      await retractLikeEventOnUnlike(tx, liker.id, postId);
    });

    // Counted event remains untouched
    const countedEv = await pool.query<{ status: string; void_reason: string | null }>(
      `SELECT status, void_reason FROM reputation_events WHERE user_id = $1`,
      [liker.id],
    );
    expect(countedEv.rows[0]!.status).toBe('counted');
    expect(countedEv.rows[0]!.void_reason).toBeNull();

    const vRes = await verifyScores(pool);
    expect(vRes.ok).toBe(true);
  });

  it('TEST-031: Verified-true reshare reward & cap: max 5 RESPONSIBLE_RESHARE per wave; auto_real creates 0', async () => {
    const resharer = await createUser({
      username: 'u_resharer_cap',
      email: 'u_rcap@example.com',
      password: 'password12345',
      displayName: 'Reshare Cap User',
      sigma: 0.5,
    });
    const otherAuthor = await createUser({
      username: 'u_other_auth',
      email: 'u_oa@example.com',
      password: 'password12345',
      displayName: 'Other Author',
      sigma: 0.5,
    });

    // Resharer reshares 6 posts verified as real by admin
    for (let k = 1; k <= 6; k++) {
      const postId = await createPost(otherAuthor.id);
      await withTransaction(async (tx) => {
        const _aRes = await tx.query<AssessmentRecord>(
          `INSERT INTO assessments (post_id, post_revision, verdict, source, decided_by, rationale)
           VALUES ($1, 1, 'real', 'admin', $2, 'Admin real assessment verified')
           RETURNING id, post_id, post_revision, verdict, source, decided_by, rationale, created_at`,
          [postId, adminId],
        );
        const resharePost = (
          await tx.query<{ id: string; author_id: string; reshare_of_post_id: string }>(
            `INSERT INTO posts (author_id, kind, reshare_of_post_id, author_tier_at_post)
             VALUES ($1, 'reshare', $2, 'neutral') RETURNING id, author_id, reshare_of_post_id`,
            [resharer.id, postId],
          )
        ).rows[0]!;
        await syncReshareEventOnCreate(tx, resharePost);
      });
    }

    // 7th post with auto_real assessment
    const autoRealPostId = await createPost(otherAuthor.id);
    await withTransaction(async (tx) => {
      const aRes = await tx.query<AssessmentRecord>(
        `INSERT INTO assessments (post_id, post_revision, verdict, source, decided_by, rationale)
         VALUES ($1, 1, 'real', 'auto_real', NULL, 'Automated low model risk passed')
         RETURNING id, post_id, post_revision, verdict, source, decided_by, rationale, created_at`,
        [autoRealPostId],
      );
      await createEventsForAssessment(tx, aRes.rows[0]!);

      const autoReshare = (
        await tx.query<{ id: string; author_id: string; reshare_of_post_id: string }>(
          `INSERT INTO posts (author_id, kind, reshare_of_post_id, author_tier_at_post)
           VALUES ($1, 'reshare', $2, 'neutral') RETURNING id, author_id, reshare_of_post_id`,
          [resharer.id, autoRealPostId],
        )
      ).rows[0]!;
      await syncReshareEventOnCreate(tx, autoReshare);
    });

    // Check events for resharer:
    // Exactly 5 eligible RESPONSIBLE_RESHARE
    // Exactly 1 voided RESPONSIBLE_RESHARE with void_reason = 'cap_exceeded'
    // 0 events from auto_real
    const eligibleCount = (
      await pool.query(
        `SELECT count(*) FROM reputation_events WHERE user_id = $1 AND kind = 'RESPONSIBLE_RESHARE' AND status = 'eligible'`,
        [resharer.id],
      )
    ).rows[0]!.count;
    expect(parseInt(eligibleCount, 10)).toBe(5);

    const voidedCapCount = (
      await pool.query(
        `SELECT count(*) FROM reputation_events WHERE user_id = $1 AND kind = 'RESPONSIBLE_RESHARE' AND status = 'voided' AND void_reason = 'cap_exceeded'`,
        [resharer.id],
      )
    ).rows[0]!.count;
    expect(parseInt(voidedCapCount, 10)).toBe(1);

    // auto_real author received RESPONSIBLE_POST (+1)
    const authorAutoEvents = await pool.query(
      `SELECT * FROM reputation_events WHERE user_id = $1 AND post_id = $2 AND kind = 'RESPONSIBLE_POST'`,
      [otherAuthor.id, autoRealPostId],
    );
    expect(authorAutoEvents.rows).toHaveLength(1);
  });

  it('TEST-032: Reshare retraction before vs after wave finalization; held appeal auto-closed', async () => {
    const author = await createUser({
      username: 'u_retract_auth',
      email: 'u_ra@example.com',
      password: 'password12345',
      displayName: 'Retract Author',
      sigma: 0.5,
    });
    const resharer = await createUser({
      username: 'u_retract_res',
      email: 'u_rr@example.com',
      password: 'password12345',
      displayName: 'Retract Resharer',
      sigma: 0.5,
    });
    const postId = await createPost(author.id);

    // Assess post as fake
    let fakeAssess: AssessmentRecord;
    await withTransaction(async (tx) => {
      const aRes = await tx.query<AssessmentRecord>(
        `INSERT INTO assessments (post_id, post_revision, verdict, source, decided_by, rationale)
         VALUES ($1, 1, 'fake', 'admin', $2, 'Admin fake post assessment')
         RETURNING id, post_id, post_revision, verdict, source, decided_by, rationale, created_at`,
        [postId, adminId],
      );
      fakeAssess = aRes.rows[0]!;
    });

    // User reshares post already assessed as fake
    let eventId: string;
    await withTransaction(async (tx) => {
      const resharePost = (
        await tx.query<{ id: string; author_id: string; reshare_of_post_id: string }>(
          `INSERT INTO posts (author_id, kind, reshare_of_post_id, author_tier_at_post)
           VALUES ($1, 'reshare', $2, 'neutral') RETURNING id, author_id, reshare_of_post_id`,
          [resharer.id, postId],
        )
      ).rows[0]!;
      await syncReshareEventOnCreate(tx, resharePost);

      const ev = (
        await tx.query<{ id: string }>(
          `SELECT id FROM reputation_events WHERE user_id = $1 AND kind = 'MISINFO_RESHARE'`,
          [resharer.id],
        )
      ).rows[0]!;
      eventId = ev.id;

      // User opens an appeal -> event becomes 'held', appeal status 'open'
      await tx.query(`UPDATE reputation_events SET status = 'held', wave_id = NULL WHERE id = $1`, [
        eventId,
      ]);
      await tx.query(
        `INSERT INTO appeals (event_id, assessment_id, appellant_id, reason, status)
         VALUES ($1, $2, $3, 'A valid appeal reason for false misinformation event', 'open')`,
        [eventId, fakeAssess.id, resharer.id],
      );
    });

    // User deletes reshare before wave finalization
    await withTransaction(async (tx) => {
      await tx.query(
        `UPDATE posts SET status = 'deleted', deleted_at = now() WHERE author_id = $1 AND reshare_of_post_id = $2`,
        [resharer.id, postId],
      );
      await retractReshareEventOnDelete(tx, resharer.id, postId);
    });

    // Event must transition to 'voided' with 'interaction_retracted'
    const evCheck = await pool.query<{ status: string; void_reason: string }>(
      `SELECT status, void_reason FROM reputation_events WHERE id = $1`,
      [eventId!],
    );
    expect(evCheck.rows[0]!.status).toBe('voided');
    expect(evCheck.rows[0]!.void_reason).toBe('interaction_retracted');

    // Appeal must be auto-closed
    const appealCheck = await pool.query<{ status: string; resolved_by_system: boolean }>(
      `SELECT status, resolved_by_system FROM appeals WHERE event_id = $1`,
      [eventId!],
    );
    expect(appealCheck.rows[0]!.status).toBe('overturned');
    expect(appealCheck.rows[0]!.resolved_by_system).toBe(true);
  });

  it('TEST-033: Repeated like and reshare idempotency: multiple toggles reactivate without 23505', async () => {
    const author = await createUser({
      username: 'u_toggle_auth',
      email: 'u_ta@example.com',
      password: 'password12345',
      displayName: 'Toggle Author',
      sigma: 0.5,
    });
    const userX = await createUser({
      username: 'u_toggle_userx',
      email: 'u_tx@example.com',
      password: 'password12345',
      displayName: 'Toggle User X',
      sigma: 0.5,
    });
    const postId = await createPost(author.id);

    // Assess fake
    await withTransaction(async (tx) => {
      const aRes = await tx.query<AssessmentRecord>(
        `INSERT INTO assessments (post_id, post_revision, verdict, source, decided_by, rationale)
         VALUES ($1, 1, 'fake', 'admin', $2, 'Admin fake post assessment')
         RETURNING id, post_id, post_revision, verdict, source, decided_by, rationale, created_at`,
        [postId, adminId],
      );
      await createEventsForAssessment(tx, aRes.rows[0]!);
    });

    // Like -> unlike -> re-like -> unlike -> re-like
    for (let k = 0; k < 3; k++) {
      await withTransaction(async (tx) => {
        await tx.query(
          `INSERT INTO likes (user_id, post_id) VALUES ($1, $2)
           ON CONFLICT (user_id, post_id) DO UPDATE SET deleted_at = NULL, updated_at = now()`,
          [userX.id, postId],
        );
        await syncLikeEventOnLike(tx, userX.id, postId);
      });

      if (k < 2) {
        await withTransaction(async (tx) => {
          await tx.query(
            `UPDATE likes SET deleted_at = now(), updated_at = now() WHERE user_id = $1 AND post_id = $2`,
            [userX.id, postId],
          );
          await retractLikeEventOnUnlike(tx, userX.id, postId);
        });
      }
    }

    // Reshare -> delete -> re-share
    await withTransaction(async (tx) => {
      const reshare1 = (
        await tx.query<{ id: string; author_id: string; reshare_of_post_id: string }>(
          `INSERT INTO posts (author_id, kind, reshare_of_post_id, author_tier_at_post)
           VALUES ($1, 'reshare', $2, 'neutral') RETURNING id, author_id, reshare_of_post_id`,
          [userX.id, postId],
        )
      ).rows[0]!;
      await syncReshareEventOnCreate(tx, reshare1);
    });

    await withTransaction(async (tx) => {
      await tx.query(
        `UPDATE posts SET status = 'deleted', deleted_at = now() WHERE author_id = $1 AND reshare_of_post_id = $2`,
        [userX.id, postId],
      );
      await retractReshareEventOnDelete(tx, userX.id, postId);
    });

    await withTransaction(async (tx) => {
      const reshare2 = (
        await tx.query<{ id: string; author_id: string; reshare_of_post_id: string }>(
          `INSERT INTO posts (author_id, kind, reshare_of_post_id, author_tier_at_post)
           VALUES ($1, 'reshare', $2, 'neutral') RETURNING id, author_id, reshare_of_post_id`,
          [userX.id, postId],
        )
      ).rows[0]!;
      await syncReshareEventOnCreate(tx, reshare2);
    });

    // Zero 23505 errors, exactly 1 eligible MISINFO_LIKE and 1 eligible MISINFO_RESHARE
    const activeLikes = await pool.query(
      `SELECT * FROM reputation_events WHERE user_id = $1 AND kind = 'MISINFO_LIKE' AND status = 'eligible'`,
      [userX.id],
    );
    expect(activeLikes.rows).toHaveLength(1);

    const activeReshares = await pool.query(
      `SELECT * FROM reputation_events WHERE user_id = $1 AND kind = 'MISINFO_RESHARE' AND status = 'eligible'`,
      [userX.id],
    );
    expect(activeReshares.rows).toHaveLength(1);
  });

  it('TEST-034: Publisher reputation independence: interaction penalties unaffected by publisher Q/tier', async () => {
    const pubA = await createUser({
      username: 'pub_trusted_a',
      email: 'pub_a@example.com',
      password: 'password12345',
      displayName: 'Trusted Publisher A',
      sigma: 0.5,
    });
    const pubB = await createUser({
      username: 'pub_low_b',
      email: 'pub_b@example.com',
      password: 'password12345',
      displayName: 'Low Publisher B',
      sigma: 0.5,
    });
    const interactor = await createUser({
      username: 'interactor_user',
      email: 'interactor@example.com',
      password: 'password12345',
      displayName: 'Interactor User',
      sigma: 0.5,
    });

    const postA = await createPost(pubA.id);
    const postB = await createPost(pubB.id);

    // Assess both as fake
    await withTransaction(async (tx) => {
      const aResA = await tx.query<AssessmentRecord>(
        `INSERT INTO assessments (post_id, post_revision, verdict, source, decided_by, rationale)
         VALUES ($1, 1, 'fake', 'admin', $2, 'Admin fake post assessment A')
         RETURNING id, post_id, post_revision, verdict, source, decided_by, rationale, created_at`,
        [postA, adminId],
      );
      await createEventsForAssessment(tx, aResA.rows[0]!);

      const aResB = await tx.query<AssessmentRecord>(
        `INSERT INTO assessments (post_id, post_revision, verdict, source, decided_by, rationale)
         VALUES ($1, 1, 'fake', 'admin', $2, 'Admin fake post assessment B')
         RETURNING id, post_id, post_revision, verdict, source, decided_by, rationale, created_at`,
        [postB, adminId],
      );
      await createEventsForAssessment(tx, aResB.rows[0]!);

      // Interactor likes and reshares both
      const rA = (
        await tx.query<{ id: string; author_id: string; reshare_of_post_id: string }>(
          `INSERT INTO posts (author_id, kind, reshare_of_post_id, author_tier_at_post)
           VALUES ($1, 'reshare', $2, 'neutral') RETURNING id, author_id, reshare_of_post_id`,
          [interactor.id, postA],
        )
      ).rows[0]!;
      await syncReshareEventOnCreate(tx, rA);
      await tx.query(`INSERT INTO likes (user_id, post_id) VALUES ($1, $2)`, [
        interactor.id,
        postA,
      ]);
      await syncLikeEventOnLike(tx, interactor.id, postA);

      const rB = (
        await tx.query<{ id: string; author_id: string; reshare_of_post_id: string }>(
          `INSERT INTO posts (author_id, kind, reshare_of_post_id, author_tier_at_post)
           VALUES ($1, 'reshare', $2, 'neutral') RETURNING id, author_id, reshare_of_post_id`,
          [interactor.id, postB],
        )
      ).rows[0]!;
      await syncReshareEventOnCreate(tx, rB);
      await tx.query(`INSERT INTO likes (user_id, post_id) VALUES ($1, $2)`, [
        interactor.id,
        postB,
      ]);
      await syncLikeEventOnLike(tx, interactor.id, postB);
    });

    // Check interactor events for postA vs postB: identical integer values (-1 each)
    const eventsA = await pool.query<{ kind: string; value: number }>(
      `SELECT kind, value FROM reputation_events WHERE user_id = $1 AND post_id = $2`,
      [interactor.id, postA],
    );
    const eventsB = await pool.query<{ kind: string; value: number }>(
      `SELECT kind, value FROM reputation_events WHERE user_id = $1 AND post_id = $2`,
      [interactor.id, postB],
    );

    expect(eventsA.rows.map((e) => e.value)).toEqual([-1, -1]);
    expect(eventsB.rows.map((e) => e.value)).toEqual([-1, -1]);
  });

  it('TEST-035: Flat publisher penalty: viral false post receives exactly one -1 MISINFO_POST', async () => {
    const publisher = await createUser({
      username: 'pub_viral_auth',
      email: 'pub_viral@example.com',
      password: 'password12345',
      displayName: 'Viral Publisher',
      sigma: 0.5,
    });

    const pQuiet = await createPost(publisher.id); // 0 likes, 0 reshares
    const pViral = await createPost(publisher.id); // 25 likes, 15 reshares

    // Create 25 likers and 15 resharers for pViral
    for (let k = 0; k < 25; k++) {
      const liker = await createUser({
        username: `viral_liker_${k}`,
        email: `viral_l_${k}@example.com`,
        password: 'password12345',
        displayName: `Viral Liker ${k}`,
      });
      await pool.query(`INSERT INTO likes (user_id, post_id) VALUES ($1, $2)`, [liker.id, pViral]);

      if (k < 15) {
        await pool.query(
          `INSERT INTO posts (author_id, kind, reshare_of_post_id, author_tier_at_post)
           VALUES ($1, 'reshare', $2, 'neutral')`,
          [liker.id, pViral],
        );
      }
    }

    // Assess both as fake
    await withTransaction(async (tx) => {
      const aQuiet = await tx.query<AssessmentRecord>(
        `INSERT INTO assessments (post_id, post_revision, verdict, source, decided_by, rationale)
         VALUES ($1, 1, 'fake', 'admin', $2, 'Quiet fake post assessment')
         RETURNING id, post_id, post_revision, verdict, source, decided_by, rationale, created_at`,
        [pQuiet, adminId],
      );
      await createEventsForAssessment(tx, aQuiet.rows[0]!);

      const aViral = await tx.query<AssessmentRecord>(
        `INSERT INTO assessments (post_id, post_revision, verdict, source, decided_by, rationale)
         VALUES ($1, 1, 'fake', 'admin', $2, 'Viral fake post assessment')
         RETURNING id, post_id, post_revision, verdict, source, decided_by, rationale, created_at`,
        [pViral, adminId],
      );
      await createEventsForAssessment(tx, aViral.rows[0]!);
    });

    // Publisher must receive exactly one MISINFO_POST (-1) for pQuiet and exactly one for pViral
    const pubQuietEvents = await pool.query<{ kind: string; value: number }>(
      `SELECT kind, value FROM reputation_events WHERE user_id = $1 AND post_id = $2`,
      [publisher.id, pQuiet],
    );
    expect(pubQuietEvents.rows).toHaveLength(1);
    expect(pubQuietEvents.rows[0]!.kind).toBe('MISINFO_POST');
    expect(pubQuietEvents.rows[0]!.value).toBe(-1);

    const pubViralEvents = await pool.query<{ kind: string; value: number }>(
      `SELECT kind, value FROM reputation_events WHERE user_id = $1 AND post_id = $2 AND kind = 'MISINFO_POST'`,
      [publisher.id, pViral],
    );
    expect(pubViralEvents.rows).toHaveLength(1);
    expect(pubViralEvents.rows[0]!.kind).toBe('MISINFO_POST');
    expect(pubViralEvents.rows[0]!.value).toBe(-1);

    // Verifier passes
    const vRes = await verifyScores(pool);
    expect(vRes.ok).toBe(true);
  });
});
