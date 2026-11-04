/**
 * apps/api/test/modules/score/score.test.ts (TASK-045)
 *
 * Tests for Score module endpoints:
 *   - GET /me/score (pending aggregate across all 7 event kinds, sigma, tier, delta)
 *   - GET /me/score/history & GET /me/score/history/:waveNumber (ledger rows & wave events)
 *   - GET /me/events (exposing void reasons and status filter)
 *   - POST /events/:id/appeal & GET /me/appeals (RUL-016 appeal lifecycle)
 *   - GET /users/:username/score (RUL-023 score visibility)
 *   - GET /waves/current (current open wave)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../../../src/app.js';
import { getTestPool, closeTestPool, truncateAll } from '../../setup/db.js';
import { config } from '../../../src/config.js';
import { createUser } from '../../../src/modules/users/service.js';

function extractCookie(headers: Record<string, unknown>): string {
  const h = headers['set-cookie'];
  return Array.isArray(h) ? String(h[0] || '') : typeof h === 'string' ? h : '';
}

describe('Score Module (TASK-045)', () => {
  const app = createApp();
  const request = supertest(app);

  beforeAll(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await closeTestPool();
  });

  it('GET /waves/current: returns current open wave', async () => {
    const res = await request.get('/api/v1/waves/current').set('X-Forwarded-For', '10.0.20.1');

    expect(res.status).toBe(200);
    expect(res.body.number).toBeGreaterThanOrEqual(1);
    expect(res.body.openedAt).toBeDefined();
  });

  it('GET /me/score: computes pending aggregate across all 7 event kinds and projected delta', async () => {
    const user = await createUser({
      username: 'score_user_me',
      email: 'score_me@example.com',
      password: 'password123',
      displayName: 'Score User',
      sigma: 0.5,
    });

    const admin = await createUser({
      username: 'score_admin_u',
      email: 'score_admin@example.com',
      password: 'password123',
      displayName: 'Score Admin',
      role: 'admin',
    });

    const pool = getTestPool();
    const openWave = await pool.query<{ id: string; number: number }>(
      `SELECT id, number FROM waves WHERE status = 'open' LIMIT 1`,
    );
    const waveId = openWave.rows[0]!.id;

    // Create a post
    const postIns = await pool.query<{ id: string }>(
      `INSERT INTO posts (author_id, kind, body, status, author_tier_at_post)
       VALUES ($1, 'original', 'Post for score module testing pending calculation', 'published', 'neutral')
       RETURNING id`,
      [user.id],
    );
    const postId = postIns.rows[0]!.id;

    // Assessment
    const assessIns = await pool.query<{ id: string }>(
      `INSERT INTO assessments (post_id, post_revision, verdict, source, decided_by, rationale, is_current)
       VALUES ($1, 1, 'real', 'admin', $2, 'Assessment for score module test', true)
       RETURNING id`,
      [postId, admin.id],
    );
    const assessId = assessIns.rows[0]!.id;

    // Insert 4 eligible events:
    // 1. RESPONSIBLE_POST (+1) -> nPos +1
    const e1 = await pool.query<{ id: string }>(
      `INSERT INTO reputation_events (user_id, post_id, assessment_id, kind, value, status, wave_id)
       VALUES ($1, $2, $3, 'RESPONSIBLE_POST', 1, 'eligible', $4) RETURNING id`,
      [user.id, postId, assessId, waveId],
    );

    // 2. VALID_REPORT (+1) -> nPos +1
    await pool.query(
      `INSERT INTO reputation_events (user_id, post_id, assessment_id, kind, value, status, wave_id)
       VALUES ($1, $2, $3, 'VALID_REPORT', 1, 'eligible', $4)`,
      [user.id, postId, assessId, waveId],
    );

    // 3. MISINFO_LIKE (-1) -> nNeg +1
    await pool.query(
      `INSERT INTO reputation_events (user_id, post_id, assessment_id, kind, value, status, wave_id)
       VALUES ($1, $2, $3, 'MISINFO_LIKE', -1, 'eligible', $4)`,
      [user.id, postId, assessId, waveId],
    );

    // 4. REVERSAL (+1) -> nAdj +1
    await pool.query(
      `INSERT INTO reputation_events (user_id, post_id, assessment_id, kind, value, status, wave_id, reverses_event_id)
       VALUES ($1, $2, $3, 'REVERSAL', 1, 'eligible', $4, $5)`,
      [user.id, postId, assessId, waveId, e1.rows[0]!.id],
    );

    const loginRes = await request
      .post('/api/v1/auth/login')
      .set('Origin', config.APP_ORIGIN)
      .set('X-Forwarded-For', '10.0.20.2')
      .send({ identifier: user.email, password: 'password123' });
    const userCookie = extractCookie(loginRes.headers);

    const res = await request
      .get('/api/v1/me/score')
      .set('Cookie', userCookie)
      .set('X-Forwarded-For', '10.0.20.3');

    expect(res.status).toBe(200);
    expect(res.body.q).toBe('0.000');
    expect(res.body.sigma).toBe('0.500');
    expect(res.body.tier).toBe('neutral');
    expect(res.body.currentWave.number).toBe(openWave.rows[0]!.number);
    // nPos = 2, nNeg = 1, nAdj = 1, r = 2 - 1 + 1 = 2
    expect(res.body.currentWave.pending.nPos).toBe(2);
    expect(res.body.currentWave.pending.nNeg).toBe(1);
    expect(res.body.currentWave.pending.nAdj).toBe(1);
    expect(res.body.currentWave.pending.r).toBe(2);
    // projectedDelta = 0.500 * 2 = 1.000
    expect(res.body.currentWave.pending.projectedDelta).toBe('1.000');
    expect(res.body.thresholds.trustedMin).toBe(config.Q_TRUSTED_MIN.toFixed(3));
    expect(res.body.thresholds.lowMax).toBe(config.Q_LOW_MAX.toFixed(3));
  });

  it('GET /me/score/history and GET /me/score/history/:waveNumber: returns ledger rows and wave events', async () => {
    const user = await createUser({
      username: 'ledger_history_u',
      email: 'ledger_hist@example.com',
      password: 'password123',
      displayName: 'Ledger User',
    });

    const admin = await createUser({
      username: 'ledger_admin_u',
      email: 'ledger_admin@example.com',
      password: 'password123',
      displayName: 'Ledger Admin',
      role: 'admin',
    });

    const pool = getTestPool();

    // Create a closed wave
    const waveRes = await pool.query<{ id: string }>(
      `INSERT INTO waves (number, status, formula_version, opened_at, finalized_at)
       VALUES (99, 'finalized', 'paper-eq2-v1', now() - INTERVAL '1 day', now() - INTERVAL '12 hours')
       RETURNING id`,
    );
    const waveId = waveRes.rows[0]!.id;

    // Insert user_wave_reputation row with app.scoring override
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL app.scoring = 'on'");
      await client.query(
        `INSERT INTO user_wave_reputation (
           user_id, wave_id, n_pos, n_neg, n_adj, r, sigma_used, q_before, delta, q_after, formula_version
         ) VALUES ($1, $2, 2, 0, 0, 2, 0.500, 0.000, 1.000, 1.000, 'paper-eq2-v1')`,
        [user.id, waveId],
      );
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    // Create a post & assessment
    const postIns = await pool.query<{ id: string }>(
      `INSERT INTO posts (author_id, kind, body, status, author_tier_at_post)
       VALUES ($1, 'original', 'Post for ledger wave history details testing', 'published', 'neutral')
       RETURNING id`,
      [user.id],
    );
    const postId = postIns.rows[0]!.id;

    const assessIns = await pool.query<{ id: string }>(
      `INSERT INTO assessments (post_id, post_revision, verdict, source, decided_by, rationale, is_current)
       VALUES ($1, 1, 'real', 'admin', $2, 'Assessment for wave 99 event', true)
       RETURNING id`,
      [postId, admin.id],
    );
    const assessId = assessIns.rows[0]!.id;

    // Counted event in wave 99
    await pool.query(
      `INSERT INTO reputation_events (user_id, post_id, assessment_id, kind, value, status, wave_id)
       VALUES ($1, $2, $3, 'RESPONSIBLE_POST', 1, 'counted', $4)`,
      [user.id, postId, assessId, waveId],
    );

    const loginRes = await request
      .post('/api/v1/auth/login')
      .set('Origin', config.APP_ORIGIN)
      .set('X-Forwarded-For', '10.0.21.1')
      .send({ identifier: user.email, password: 'password123' });
    const userCookie = extractCookie(loginRes.headers);

    // 1. GET /me/score/history
    const histRes = await request
      .get('/api/v1/me/score/history')
      .set('Cookie', userCookie)
      .set('X-Forwarded-For', '10.0.21.2');
    expect(histRes.status).toBe(200);
    expect(histRes.body.items.length).toBeGreaterThanOrEqual(1);
    const entry = histRes.body.items.find((r: { waveNumber: number }) => r.waveNumber === 99);
    expect(entry).toBeDefined();
    expect(entry.nPos).toBe(2);
    expect(entry.r).toBe(2);
    expect(entry.delta).toBe('1.000');

    // 2. GET /me/score/history/99
    const waveDetail = await request
      .get('/api/v1/me/score/history/99')
      .set('Cookie', userCookie)
      .set('X-Forwarded-For', '10.0.21.3');
    expect(waveDetail.status).toBe(200);
    expect(waveDetail.body.row.waveNumber).toBe(99);
    expect(waveDetail.body.events).toHaveLength(1);
    expect(waveDetail.body.events[0].kind).toBe('RESPONSIBLE_POST');
    expect(waveDetail.body.events[0].assessment.verdict).toBe('real');

    // 3. GET /me/score/history/9999 (not found) -> 404
    const notFoundRes = await request
      .get('/api/v1/me/score/history/9999')
      .set('Cookie', userCookie)
      .set('X-Forwarded-For', '10.0.21.4');
    expect(notFoundRes.status).toBe(404);
  });

  it('GET /me/events: lists events with status filter, post excerpt, and void reasons', async () => {
    const user = await createUser({
      username: 'events_list_u',
      email: 'events_list@example.com',
      password: 'password123',
      displayName: 'Events User',
    });

    const admin = await createUser({
      username: 'events_admin_u',
      email: 'events_admin@example.com',
      password: 'password123',
      displayName: 'Events Admin',
      role: 'admin',
    });

    const pool = getTestPool();
    const postIns = await pool.query<{ id: string }>(
      `INSERT INTO posts (author_id, kind, body, status, author_tier_at_post)
       VALUES ($1, 'original', 'Post excerpt testing for events list endpoint', 'published', 'neutral')
       RETURNING id`,
      [user.id],
    );
    const postId = postIns.rows[0]!.id;

    const assessIns = await pool.query<{ id: string }>(
      `INSERT INTO assessments (post_id, post_revision, verdict, source, decided_by, rationale, is_current)
       VALUES ($1, 1, 'fake', 'admin', $2, 'Assessment for events testing', true)
       RETURNING id`,
      [postId, admin.id],
    );
    const assessId = assessIns.rows[0]!.id;

    const openWave = await pool.query<{ id: string }>(
      `SELECT id FROM waves WHERE status = 'open' LIMIT 1`,
    );
    const waveId = openWave.rows[0]!.id;

    // 1 eligible event (with wave_id), 1 voided event with cap_exceeded (wave_id NULL)
    await pool.query(
      `INSERT INTO reputation_events (user_id, post_id, assessment_id, kind, value, status, wave_id, void_reason)
       VALUES
         ($1, $2, $3, 'MISINFO_POST', -1, 'eligible', $4, NULL),
         ($1, $2, $3, 'RESPONSIBLE_RESHARE', 1, 'voided', NULL, 'cap_exceeded')`,
      [user.id, postId, assessId, waveId],
    );

    const loginRes = await request
      .post('/api/v1/auth/login')
      .set('Origin', config.APP_ORIGIN)
      .set('X-Forwarded-For', '10.0.22.1')
      .send({ identifier: user.email, password: 'password123' });
    const userCookie = extractCookie(loginRes.headers);

    // All events
    const allRes = await request
      .get('/api/v1/me/events')
      .set('Cookie', userCookie)
      .set('X-Forwarded-For', '10.0.22.2');
    expect(allRes.status).toBe(200);
    expect(allRes.body.items).toHaveLength(2);

    // Filter status=voided
    const voidedRes = await request
      .get('/api/v1/me/events?status=voided')
      .set('Cookie', userCookie)
      .set('X-Forwarded-For', '10.0.22.3');
    expect(voidedRes.status).toBe(200);
    expect(voidedRes.body.items).toHaveLength(1);
    expect(voidedRes.body.items[0].voidReason).toBe('cap_exceeded');
  });

  it('POST /events/:id/appeal & GET /me/appeals: creates appeal and transitions event to held', async () => {
    const user = await createUser({
      username: 'appealer_user',
      email: 'appealer@example.com',
      password: 'password123',
      displayName: 'Appealer User',
    });

    const admin = await createUser({
      username: 'appeal_admin_u',
      email: 'appeal_admin@example.com',
      password: 'password123',
      displayName: 'Appeal Admin',
      role: 'admin',
    });

    const pool = getTestPool();
    const openWave = await pool.query<{ id: string }>(
      `SELECT id FROM waves WHERE status = 'open' LIMIT 1`,
    );
    const waveId = openWave.rows[0]!.id;

    const postIns = await pool.query<{ id: string }>(
      `INSERT INTO posts (author_id, kind, body, status, author_tier_at_post)
       VALUES ($1, 'original', 'Post that resulted in negative misinfo event', 'published', 'neutral')
       RETURNING id`,
      [user.id],
    );
    const postId = postIns.rows[0]!.id;

    const assessIns = await pool.query<{ id: string }>(
      `INSERT INTO assessments (post_id, post_revision, verdict, source, decided_by, rationale, is_current)
       VALUES ($1, 1, 'fake', 'admin', $2, 'Assessment for appeal test', true)
       RETURNING id`,
      [postId, admin.id],
    );
    const assessId = assessIns.rows[0]!.id;

    // Eligible negative event
    const eventIns = await pool.query<{ id: string }>(
      `INSERT INTO reputation_events (user_id, post_id, assessment_id, kind, value, status, wave_id)
       VALUES ($1, $2, $3, 'MISINFO_POST', -1, 'eligible', $4)
       RETURNING id`,
      [user.id, postId, assessId, waveId],
    );
    const eventId = eventIns.rows[0]!.id;

    const loginRes = await request
      .post('/api/v1/auth/login')
      .set('Origin', config.APP_ORIGIN)
      .set('X-Forwarded-For', '10.0.23.1')
      .send({ identifier: user.email, password: 'password123' });
    const userCookie = extractCookie(loginRes.headers);

    // 1. Submit appeal
    const appealRes = await request
      .post(`/api/v1/events/${eventId}/appeal`)
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', userCookie)
      .set('X-Forwarded-For', '10.0.23.2')
      .send({
        reason: 'This assessment was incorrect, the source is official government data.',
      });

    expect(appealRes.status).toBe(201);
    expect(appealRes.body.id).toBeDefined();
    expect(appealRes.body.status).toBe('open');

    // 2. Verify event in DB transitioned to 'held' and wave_id = NULL
    const evRow = await pool.query(`SELECT status, wave_id FROM reputation_events WHERE id = $1`, [
      eventId,
    ]);
    expect(evRow.rows[0]!.status).toBe('held');
    expect(evRow.rows[0]!.wave_id).toBeNull();

    // 3. Repeated appeal -> 409
    const dupRes = await request
      .post(`/api/v1/events/${eventId}/appeal`)
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', userCookie)
      .set('X-Forwarded-For', '10.0.23.3')
      .send({ reason: 'Duplicate appeal submission attempt here' });
    expect(dupRes.status).toBe(409);
    expect(dupRes.body.error.code).toBe('ALREADY_EXISTS');

    // 4. GET /me/appeals
    const listRes = await request
      .get('/api/v1/me/appeals')
      .set('Cookie', userCookie)
      .set('X-Forwarded-For', '10.0.23.4');
    expect(listRes.status).toBe(200);
    expect(listRes.body.items).toHaveLength(1);
    expect(listRes.body.items[0].id).toBe(appealRes.body.id);
    expect(listRes.body.items[0].status).toBe('open');
  });

  it('GET /users/:username/score: respects RUL-023 score visibility', async () => {
    const targetUser = await createUser({
      username: 'target_visibility_u',
      email: 'target_vis@example.com',
      password: 'password123',
      displayName: 'Target User',
    });

    const otherUser = await createUser({
      username: 'other_viewer_u',
      email: 'other_viewer@example.com',
      password: 'password123',
      displayName: 'Other Viewer',
    });

    const admin = await createUser({
      username: 'admin_vis_u',
      email: 'admin_vis@example.com',
      password: 'password123',
      displayName: 'Admin User',
      role: 'admin',
    });

    // 1. Anonymous viewer: only tier returned
    const anonRes = await request
      .get(`/api/v1/users/${targetUser.username}/score`)
      .set('X-Forwarded-For', '10.0.24.1');
    expect(anonRes.status).toBe(200);
    expect(anonRes.body.tier).toBe('neutral');
    expect(anonRes.body.q).toBeUndefined();

    // 2. Other regular user viewer: only tier returned
    const otherLogin = await request
      .post('/api/v1/auth/login')
      .set('Origin', config.APP_ORIGIN)
      .set('X-Forwarded-For', '10.0.24.2')
      .send({ identifier: otherUser.email, password: 'password123' });
    const otherCookie = extractCookie(otherLogin.headers);

    const otherRes = await request
      .get(`/api/v1/users/${targetUser.username}/score`)
      .set('Cookie', otherCookie)
      .set('X-Forwarded-For', '10.0.24.3');
    expect(otherRes.status).toBe(200);
    expect(otherRes.body.tier).toBe('neutral');
    expect(otherRes.body.q).toBeUndefined();

    // 3. Target user viewing self: includes q
    const selfLogin = await request
      .post('/api/v1/auth/login')
      .set('Origin', config.APP_ORIGIN)
      .set('X-Forwarded-For', '10.0.24.4')
      .send({ identifier: targetUser.email, password: 'password123' });
    const selfCookie = extractCookie(selfLogin.headers);

    const selfRes = await request
      .get(`/api/v1/users/${targetUser.username}/score`)
      .set('Cookie', selfCookie)
      .set('X-Forwarded-For', '10.0.24.5');
    expect(selfRes.status).toBe(200);
    expect(selfRes.body.tier).toBe('neutral');
    expect(selfRes.body.q).toBe('0.000');

    // 4. Admin viewing user: includes q
    const adminLogin = await request
      .post('/api/v1/auth/login')
      .set('Origin', config.APP_ORIGIN)
      .set('X-Forwarded-For', '10.0.24.6')
      .send({ identifier: admin.email, password: 'password123' });
    const adminCookie = extractCookie(adminLogin.headers);

    const adminRes = await request
      .get(`/api/v1/users/${targetUser.username}/score`)
      .set('Cookie', adminCookie)
      .set('X-Forwarded-For', '10.0.24.7');
    expect(adminRes.status).toBe(200);
    expect(adminRes.body.tier).toBe('neutral');
    expect(adminRes.body.q).toBe('0.000');
  });
});
