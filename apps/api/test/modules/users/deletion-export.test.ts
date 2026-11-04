/**
 * apps/api/test/modules/users/deletion-export.test.ts (TASK-046)
 *
 * Tests for:
 *   - DELETE /users/me (RUL-022, SEC-014: password confirmation, PII anonymization, session purge, data retention)
 *   - GET /users/me/export (complete user archive: profile, posts, comments, active+retracted likes, follows, events, ledger, notifications)
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

describe('Account Deletion & Data Export (TASK-046, RUL-022, SEC-014)', () => {
  const app = createApp();
  const request = supertest(app);

  beforeAll(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await closeTestPool();
  });

  it('DELETE /users/me: requires auth and password confirmation', async () => {
    // 1. Unauthenticated -> 401
    const unauth = await request
      .delete('/api/v1/users/me')
      .set('Origin', config.APP_ORIGIN)
      .set('X-Forwarded-For', '10.0.30.1')
      .send({ password: 'anyPassword123' });
    expect(unauth.status).toBe(401);

    // 2. User with incorrect password -> 401
    const user = await createUser({
      username: 'u_del_wrongpwd',
      email: 'del_wrongpwd@example.com',
      password: 'correctPassword123',
      displayName: 'Wrong Password User',
    });

    const loginRes = await request
      .post('/api/v1/auth/login')
      .set('Origin', config.APP_ORIGIN)
      .set('X-Forwarded-For', '10.0.30.2')
      .send({ identifier: user.email, password: 'correctPassword123' });
    const userCookie = extractCookie(loginRes.headers);

    const wrongPwdRes = await request
      .delete('/api/v1/users/me')
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', userCookie)
      .set('X-Forwarded-For', '10.0.30.3')
      .send({ password: 'wrongPassword999' });
    expect(wrongPwdRes.status).toBe(401);
    expect(wrongPwdRes.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('DELETE /users/me: anonymizes PII, clears sessions, keeps posts & ledger per RUL-022', async () => {
    const user = await createUser({
      username: 'u_to_delete',
      email: 'to_delete@example.com',
      password: 'password123',
      displayName: 'Soon Deleted',
    });

    const pool = getTestPool();

    // 1. Insert post for user
    const postIns = await pool.query<{ id: string }>(
      `INSERT INTO posts (author_id, kind, body, status, author_tier_at_post)
       VALUES ($1, 'original', 'Post belonging to deleted user that should remain intact', 'published', 'neutral')
       RETURNING id`,
      [user.id],
    );
    const postId = postIns.rows[0]!.id;

    // 2. Insert closed wave & ledger row
    const waveRes = await pool.query<{ id: string }>(
      `INSERT INTO waves (number, status, formula_version, opened_at, finalized_at)
       VALUES (88, 'finalized', 'paper-eq2-v1', now() - INTERVAL '2 days', now() - INTERVAL '1 day')
       RETURNING id`,
    );
    const waveId = waveRes.rows[0]!.id;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL app.scoring = 'on'");
      await client.query(
        `INSERT INTO user_wave_reputation (
           user_id, wave_id, n_pos, n_neg, n_adj, r, sigma_used, q_before, delta, q_after, formula_version
         ) VALUES ($1, $2, 1, 0, 0, 1, 0.500, 0.000, 0.500, 0.500, 'paper-eq2-v1')`,
        [user.id, waveId],
      );
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    // Login user
    const loginRes = await request
      .post('/api/v1/auth/login')
      .set('Origin', config.APP_ORIGIN)
      .set('X-Forwarded-For', '10.0.31.1')
      .send({ identifier: user.email, password: 'password123' });
    const userCookie = extractCookie(loginRes.headers);

    // Delete account
    const delRes = await request
      .delete('/api/v1/users/me')
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', userCookie)
      .set('X-Forwarded-For', '10.0.31.2')
      .send({ password: 'password123' });

    expect(delRes.status).toBe(204);

    // Verify DB anonymization
    const userCheck = await pool.query(`SELECT * FROM users WHERE id = $1`, [user.id]);
    const row = userCheck.rows[0]!;
    expect(row.status).toBe('deleted');
    expect(row.deleted_at).not.toBeNull();
    expect(row.username).toMatch(/^deleted_[a-f0-9]{8}$/);
    expect(row.email).toBe(`deleted+${user.id}@invalid.local`);
    expect(row.display_name).toBe('Deleted user');
    expect(row.bio).toBe('');
    expect(row.avatar_media_id).toBeNull();
    expect(row.password_hash).toMatch(/^DELETED_/);

    // Verify sessions purged
    const sessCheck = await pool.query(`SELECT count(*) FROM sessions WHERE user_id = $1`, [
      user.id,
    ]);
    expect(parseInt(sessCheck.rows[0]!.count, 10)).toBe(0);

    // Verify post still exists in DB
    const postCheck = await pool.query(`SELECT id, status FROM posts WHERE id = $1`, [postId]);
    expect(postCheck.rows.length).toBe(1);

    // Verify ledger row still exists in DB
    const ledgerCheck = await pool.query(
      `SELECT * FROM user_wave_reputation WHERE user_id = $1 AND wave_id = $2`,
      [user.id, waveId],
    );
    expect(ledgerCheck.rows.length).toBe(1);

    // Login with old password fails
    const reLogin = await request
      .post('/api/v1/auth/login')
      .set('Origin', config.APP_ORIGIN)
      .set('X-Forwarded-For', '10.0.31.3')
      .send({ identifier: user.email, password: 'password123' });
    expect(reLogin.status).toBe(401);
  });

  it('GET /users/me/export: returns comprehensive JSON archive', async () => {
    const user = await createUser({
      username: 'u_export_user',
      email: 'export_user@example.com',
      password: 'password123',
      displayName: 'Export User',
    });

    const otherUser = await createUser({
      username: 'u_export_other',
      email: 'export_other@example.com',
      password: 'password123',
      displayName: 'Other Export User',
    });

    const pool = getTestPool();

    // 1. Post
    const postIns = await pool.query<{ id: string }>(
      `INSERT INTO posts (author_id, kind, body, status, author_tier_at_post)
       VALUES ($1, 'original', 'Post created for export archive test long enough', 'published', 'neutral')
       RETURNING id`,
      [user.id],
    );
    const postId = postIns.rows[0]!.id;

    // 2. Comment
    await pool.query(
      `INSERT INTO comments (author_id, post_id, body)
       VALUES ($1, $2, 'Comment by export user')`,
      [user.id, postId],
    );

    // 3. Likes (1 active, 1 retracted)
    await pool.query(
      `INSERT INTO likes (user_id, post_id, created_at, deleted_at)
       VALUES ($1, $2, now(), NULL)`,
      [user.id, postId],
    );
    // Create second post to like and retract
    const post2Ins = await pool.query<{ id: string }>(
      `INSERT INTO posts (author_id, kind, body, status, author_tier_at_post)
       VALUES ($1, 'original', 'Second post for retracted like export test long enough', 'published', 'neutral')
       RETURNING id`,
      [otherUser.id],
    );
    const post2Id = post2Ins.rows[0]!.id;

    await pool.query(
      `INSERT INTO likes (user_id, post_id, created_at, deleted_at)
       VALUES ($1, $2, now() - INTERVAL '1 hour', now())`,
      [user.id, post2Id],
    );

    // 4. Follows (user follows otherUser, otherUser follows user)
    await pool.query(`INSERT INTO follows (follower_id, followee_id) VALUES ($1, $2), ($2, $1)`, [
      user.id,
      otherUser.id,
    ]);

    // 5. Notification
    await pool.query(
      `INSERT INTO notifications (user_id, type, payload)
       VALUES ($1, 'like', '{"message": "Someone liked your post"}'::jsonb)`,
      [user.id],
    );

    // Login user
    const loginRes = await request
      .post('/api/v1/auth/login')
      .set('Origin', config.APP_ORIGIN)
      .set('X-Forwarded-For', '10.0.32.1')
      .send({ identifier: user.email, password: 'password123' });
    const userCookie = extractCookie(loginRes.headers);

    // Request export
    const exportRes = await request
      .get('/api/v1/users/me/export')
      .set('Cookie', userCookie)
      .set('X-Forwarded-For', '10.0.32.2');

    expect(exportRes.status).toBe(200);
    expect(exportRes.headers['content-type']).toContain('application/json');
    expect(exportRes.headers['content-disposition']).toContain('attachment');

    const data = exportRes.body;
    expect(data.exportedAt).toBeDefined();
    expect(data.profile.username).toBe('u_export_user');
    expect(data.profile.email).toBe('export_user@example.com');
    expect(data.posts).toHaveLength(1);
    expect(data.posts[0].id).toBe(postId);
    expect(data.comments).toHaveLength(1);
    expect(data.comments[0].body).toBe('Comment by export user');
    // Both active and retracted likes are exported
    expect(data.likes).toHaveLength(2);
    expect(data.follows.following).toHaveLength(1);
    expect(data.follows.followers).toHaveLength(1);
    expect(data.notifications).toHaveLength(1);
  });
});
