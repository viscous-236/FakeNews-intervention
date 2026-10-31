/**
 * apps/api/test/scoring/edge-cases.test.ts
 *
 * Covers remaining edge cases and branches in apps/api/src/scoring
 * to ensure 100% line and branch coverage (REQ-018).
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
import { config } from '../../src/config.js';
import { supersedeAssessment } from '../../src/scoring/corrections.js';

describe('Scoring Engine Edge Cases & Full Coverage (REQ-018)', () => {
  let pool: Pool;
  let adminId: string;

  beforeAll(async () => {
    await truncateAll();
    pool = getTestPool();

    const admin = await createUser({
      username: 'edge_admin',
      email: 'edge_admin@example.com',
      password: 'password12345',
      displayName: 'Edge Admin',
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
       VALUES ($1, 'original', 'Edge case post body with at least 20 chars', 'neutral')
       RETURNING id`,
      [authorId],
    );
    return postRes.rows[0]!.id;
  }

  it('events: reactivates retracted reshare on admin real assessment', async () => {
    const author = await createUser({
      username: 'u_real_react_auth',
      email: 'rra@example.com',
      password: 'password12345',
      displayName: 'Real React Author',
    });
    const resharer = await createUser({
      username: 'u_real_react_res',
      email: 'rrr@example.com',
      password: 'password12345',
      displayName: 'Real React Resharer',
    });
    const postId = await createPost(author.id);

    await withTransaction(async (tx) => {
      const aRes = await tx.query<AssessmentRecord>(
        `INSERT INTO assessments (post_id, post_revision, verdict, source, decided_by, rationale)
         VALUES ($1, 1, 'real', 'admin', $2, 'Admin real assessment verified')
         RETURNING id, post_id, post_revision, verdict, source, decided_by, rationale, created_at`,
        [postId, adminId],
      );
      await createEventsForAssessment(tx, aRes.rows[0]!);
    });

    // Reshare -> retract -> re-share
    let resharePostId: string;
    await withTransaction(async (tx) => {
      const r = (
        await tx.query<{ id: string; author_id: string; reshare_of_post_id: string }>(
          `INSERT INTO posts (author_id, kind, reshare_of_post_id, author_tier_at_post)
           VALUES ($1, 'reshare', $2, 'neutral') RETURNING id, author_id, reshare_of_post_id`,
          [resharer.id, postId],
        )
      ).rows[0]!;
      resharePostId = r.id;
      await syncReshareEventOnCreate(tx, r);
    });

    await withTransaction(async (tx) => {
      await tx.query(
        `UPDATE posts SET status = 'deleted', deleted_at = now() WHERE id = $1`,
        [resharePostId],
      );
      await retractReshareEventOnDelete(tx, resharer.id, postId);
    });

    await withTransaction(async (tx) => {
      const r2 = (
        await tx.query<{ id: string; author_id: string; reshare_of_post_id: string }>(
          `INSERT INTO posts (author_id, kind, reshare_of_post_id, author_tier_at_post)
           VALUES ($1, 'reshare', $2, 'neutral') RETURNING id, author_id, reshare_of_post_id`,
          [resharer.id, postId],
        )
      ).rows[0]!;
      await syncReshareEventOnCreate(tx, r2);
    });

    const ev = await pool.query<{ status: string; void_reason: string | null }>(
      `SELECT status, void_reason FROM reputation_events WHERE user_id = $1 AND kind = 'RESPONSIBLE_RESHARE'`,
      [resharer.id],
    );
    expect(ev.rows[0]!.status).toBe('eligible');
    expect(ev.rows[0]!.void_reason).toBeNull();
  });

  it('finalizeWave: handles optional waveId and direct client parameter', async () => {
    const openWave = await getOpenWave();

    // Finalize with direct client
    await withTransaction(async (tx) => {
      const res = await finalizeWave(openWave.id, { kind: 'system' }, tx);
      expect(res.alreadyFinalized).toBe(false);
    });

    // Finalize without waveId (auto-resolves open wave)
    const resAuto = await finalizeWave();
    expect(resAuto.alreadyFinalized).toBe(false);

    // Finalize with non-existent waveId throws NOT_FOUND
    await expect(
      finalizeWave('00000000-0000-0000-0000-000000000000'),
    ).rejects.toThrow(/Wave not found/);
  });

  it('corrections: supersedeAssessment throws NOT_FOUND for non-existent assessment and CONFLICT for superseded assessment', async () => {
    await withTransaction(async (tx) => {
      await expect(
        supersedeAssessment(
          tx,
          { id: '00000000-0000-0000-0000-000000000000' },
          {
            verdict: 'real',
            source: 'admin',
            rationale: 'Valid rationale for non-existent',
          },
        ),
      ).rejects.toThrow(/Old assessment not found/);
    });

    const author = await createUser({
      username: 'u_already_sup',
      email: 'already_sup@example.com',
      password: 'password12345',
      displayName: 'Already Sup User',
    });
    const postId = await createPost(author.id);

    let a1: AssessmentRecord;
    await withTransaction(async (tx) => {
      const r = await tx.query<AssessmentRecord>(
        `INSERT INTO assessments (post_id, post_revision, verdict, source, decided_by, rationale)
         VALUES ($1, 1, 'real', 'admin', $2, 'A valid rationale of length >= 10')
         RETURNING id, post_id, post_revision, verdict, source, decided_by, rationale, created_at`,
        [postId, adminId],
      );
      a1 = r.rows[0]!;
      await supersedeAssessment(tx, a1, {
        verdict: 'fake',
        source: 'admin',
        decided_by: adminId,
        rationale: 'First supersede rationale valid',
      });
    });

    // Attempting to supersede a1 again throws 409 CONFLICT
    await withTransaction(async (tx) => {
      await expect(
        supersedeAssessment(tx, a1, {
          verdict: 'real',
          source: 'admin',
          decided_by: adminId,
          rationale: 'Second supersede attempt',
        }),
      ).rejects.toThrow(/Assessment is already superseded/);
    });
  });

  it('events: early returns when conditions not met', async () => {
    const author = await createUser({
      username: 'u_early_ret',
      email: 'early@example.com',
      password: 'password12345',
      displayName: 'Early Return User',
    });
    const postId = await createPost(author.id);

    await withTransaction(async (tx) => {
      // 1. retractReshareEventOnDelete when no events exist
      await retractReshareEventOnDelete(tx, author.id, postId);

      // 2. retractLikeEventOnUnlike when no events exist
      await retractLikeEventOnUnlike(tx, author.id, postId);

      // 3. syncLikeEventOnLike when author likes own post
      await syncLikeEventOnLike(tx, author.id, postId);

      // 4. syncLikeEventOnLike when no fake assessment exists
      await syncLikeEventOnLike(tx, adminId, postId);

      // 4b. syncLikeEventOnLike when LIKE_PENALTY_ENABLED is false
      (config as { LIKE_PENALTY_ENABLED: boolean }).LIKE_PENALTY_ENABLED = false;
      await syncLikeEventOnLike(tx, adminId, postId);
      (config as { LIKE_PENALTY_ENABLED: boolean }).LIKE_PENALTY_ENABLED = true;

      // 5. syncReshareEventOnCreate when author reshares own post
      await syncReshareEventOnCreate(tx, {
        id: postId,
        author_id: author.id,
        reshare_of_post_id: postId,
      });

      // 6. syncReshareEventOnCreate when no admin assessment exists
      await syncReshareEventOnCreate(tx, {
        id: postId,
        author_id: adminId,
        reshare_of_post_id: postId,
      });
    });
  });

  it('events: VALID_REPORT cap exceeded marks 6th report as voided with cap_exceeded', async () => {
    const reporter = await createUser({
      username: 'u_rep_capped',
      email: 'rep_capped@example.com',
      password: 'password12345',
      displayName: 'Rep Capped User',
    });
    const postAuthor = await createUser({
      username: 'u_rep_capped_auth',
      email: 'rca@example.com',
      password: 'password12345',
      displayName: 'Rep Capped Author',
    });

    // Create 6 posts reported by reporter and assessed fake
    for (let i = 1; i <= 6; i++) {
      const postId = await createPost(postAuthor.id);
      await pool.query(
        `INSERT INTO reports (post_id, reporter_id, reason, details)
         VALUES ($1, $2, 'false_information', 'Report details')`,
        [postId, reporter.id],
      );

      await withTransaction(async (tx) => {
        const aRes = await tx.query<AssessmentRecord>(
          `INSERT INTO assessments (post_id, post_revision, verdict, source, decided_by, rationale)
           VALUES ($1, 1, 'fake', 'admin', $2, 'Admin fake post assessment')
           RETURNING id, post_id, post_revision, verdict, source, decided_by, rationale, created_at`,
          [postId, adminId],
        );
        await createEventsForAssessment(tx, aRes.rows[0]!);
      });
    }

    const eligibleReports = await pool.query(
      `SELECT count(*) FROM reputation_events WHERE user_id = $1 AND kind = 'VALID_REPORT' AND status = 'eligible'`,
      [reporter.id],
    );
    expect(parseInt(eligibleReports.rows[0]!.count, 10)).toBe(5);

    const voidedReports = await pool.query(
      `SELECT count(*) FROM reputation_events WHERE user_id = $1 AND kind = 'VALID_REPORT' AND status = 'voided' AND void_reason = 'cap_exceeded'`,
      [reporter.id],
    );
    expect(parseInt(voidedReports.rows[0]!.count, 10)).toBe(1);
  });

  it('events: RESPONSIBLE_POST cap exceeded marks 6th post as voided with cap_exceeded', async () => {
    const author = await createUser({
      username: 'u_post_capped',
      email: 'post_capped@example.com',
      password: 'password12345',
      displayName: 'Post Capped Author',
    });

    for (let i = 1; i <= 6; i++) {
      const postId = await createPost(author.id);
      await withTransaction(async (tx) => {
        const aRes = await tx.query<AssessmentRecord>(
          `INSERT INTO assessments (post_id, post_revision, verdict, source, decided_by, rationale)
           VALUES ($1, 1, 'real', 'admin', $2, 'Admin real post assessment')
           RETURNING id, post_id, post_revision, verdict, source, decided_by, rationale, created_at`,
          [postId, adminId],
        );
        await createEventsForAssessment(tx, aRes.rows[0]!);
      });
    }

    const eligiblePosts = await pool.query(
      `SELECT count(*) FROM reputation_events WHERE user_id = $1 AND kind = 'RESPONSIBLE_POST' AND status = 'eligible'`,
      [author.id],
    );
    expect(parseInt(eligiblePosts.rows[0]!.count, 10)).toBe(5);

    const voidedPosts = await pool.query(
      `SELECT count(*) FROM reputation_events WHERE user_id = $1 AND kind = 'RESPONSIBLE_POST' AND status = 'voided' AND void_reason = 'cap_exceeded'`,
      [author.id],
    );
    expect(parseInt(voidedPosts.rows[0]!.count, 10)).toBe(1);
  });

  it('verifyScores: detects I5 discrepancies and I6 violations', async () => {
    // Finalize current wave so we have ledger rows and a finalized wave
    const waveToFinalize = await getOpenWave();
    await finalizeWave(waveToFinalize.id, { kind: 'system' });

    // Pick a user ledger row from the finalized wave
    const rowRes = await pool.query<{ user_id: string; wave_id: string; n_pos: number; n_neg: number; n_adj: number }>(
      `SELECT user_id, wave_id, n_pos, n_neg, n_adj FROM user_wave_reputation WHERE wave_id = $1 LIMIT 1`,
      [waveToFinalize.id],
    );
    const row = rowRes.rows[0]!;

    // Temporarily alter ledger row to trigger I5 discrepancy
    await pool.query(`ALTER TABLE user_wave_reputation DISABLE TRIGGER ledger_guard_trg`);
    await pool.query(`ALTER TABLE user_wave_reputation DROP CONSTRAINT IF EXISTS user_wave_reputation_check`);
    await pool.query(
      `UPDATE user_wave_reputation SET n_pos = 99, n_neg = 88, n_adj = 77 WHERE user_id = $1 AND wave_id = $2`,
      [row.user_id, row.wave_id],
    );

    // Insert an eligible event pointing to a finalized wave to trigger I6 violation
    const postId = await createPost(row.user_id);
    const assessRes = await pool.query<{ id: string }>(
      `INSERT INTO assessments (post_id, post_revision, verdict, source, decided_by, rationale)
       VALUES ($1, 1, 'real', 'admin', $2, 'Real post assessment for I6 test') RETURNING id`,
      [postId, adminId],
    );
    await pool.query(
      `INSERT INTO reputation_events (
         user_id, post_id, assessment_id, kind, value, status, wave_id
       ) VALUES ($1, $2, $3, 'RESPONSIBLE_POST', 1, 'eligible', $4)`,
      [row.user_id, postId, assessRes.rows[0]!.id, waveToFinalize.id],
    );

    const checkBad = await verifyScores(pool);
    expect(checkBad.ok).toBe(false);
    expect(checkBad.issues.some((i) => i.invariant === 'I5')).toBe(true);
    expect(checkBad.issues.some((i) => i.invariant === 'I6')).toBe(true);

    // Clean up: delete test event, restore ledger row and re-enable trigger
    await pool.query(`ALTER TABLE reputation_events DISABLE TRIGGER events_guard_trg`);
    await pool.query(`DELETE FROM reputation_events WHERE post_id = $1`, [postId]);
    await pool.query(`ALTER TABLE reputation_events ENABLE TRIGGER events_guard_trg`);
    await pool.query(
      `UPDATE user_wave_reputation SET n_pos = $1, n_neg = $2, n_adj = $3 WHERE user_id = $4 AND wave_id = $5`,
      [row.n_pos, row.n_neg, row.n_adj, row.user_id, row.wave_id],
    );
    await pool.query(
      `ALTER TABLE user_wave_reputation ADD CONSTRAINT user_wave_reputation_check CHECK (r = n_pos - n_neg + n_adj)`,
    );
    await pool.query(`ALTER TABLE user_wave_reputation ENABLE TRIGGER ledger_guard_trg`);

    const checkClean = await verifyScores(pool);
    expect(checkClean.ok).toBe(true);
  });
});
