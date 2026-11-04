/**
 * apps/api/test/modules/users/users.test.ts (TASK-040)
 *
 * Tests for GET /users/:username and PATCH /users/me:
 *   - Profile retrieval with RUL-023 score visibility (tier_only vs full, self, admin)
 *   - Viewer relationship (following, blocked)
 *   - Forbidden fields rejection on PATCH /users/me
 *   - Valid profile updates (displayName, bio, avatarMediaId)
 *   - Authorization checks (unauthenticated, unverified, suspended)
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

describe('Users Module (TASK-040)', () => {
  const app = createApp();
  const request = supertest(app);

  beforeAll(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await closeTestPool();
  });

  it('GET /users/:username returns 404 for nonexistent user', async () => {
    const res = await request.get('/api/v1/users/nonexistent_ghost_999');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('GET /users/:username applies RUL-023 q visibility rules', async () => {
    const pool = getTestPool();

    // 1. Create target user with verified email
    const target = await createUser({
      username: 'target_score_user',
      email: 'target@example.com',
      password: 'targetPassword123',
      displayName: 'Target User',
    });

    // Manually adjust q in DB using transaction-local override for users_guard_trg
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL app.scoring = 'on'");
      await client.query(`UPDATE users SET q = '3.500' WHERE id = $1`, [target.id]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // 2. Anonymous request with default PUBLIC_SCORE_VISIBILITY = 'tier_only'
    config.PUBLIC_SCORE_VISIBILITY = 'tier_only';
    const anonRes = await request.get('/api/v1/users/target_score_user');
    expect(anonRes.status).toBe(200);
    expect(anonRes.body.username).toBe('target_score_user');
    expect(anonRes.body.tier).toBe('trusted');
    expect(anonRes.body.q).toBeUndefined(); // OMITTED for public viewer
    expect(anonRes.body.viewer).toEqual({ following: false, blocked: false });

    // 3. Login as target user (self)
    const selfLoginRes = await request
      .post('/api/v1/auth/login')
      .set('Origin', config.APP_ORIGIN)
      .set('X-Forwarded-For', '192.0.2.1')
      .send({
        identifier: 'target_score_user',
        password: 'targetPassword123',
      });
    expect(selfLoginRes.status).toBe(200);
    const selfCookie = extractCookie(selfLoginRes.headers);

    const selfRes = await request.get('/api/v1/users/target_score_user').set('Cookie', selfCookie);
    expect(selfRes.status).toBe(200);
    expect(selfRes.body.q).toBe('3.500'); // Visible to self!

    // 4. Create admin user and verify admin can see q
    const _admin = await createUser({
      username: 'admin_inspector',
      email: 'admin@example.com',
      password: 'adminPassword123',
      displayName: 'Admin Inspector',
      role: 'admin',
    });

    const adminLoginRes = await request
      .post('/api/v1/auth/login')
      .set('Origin', config.APP_ORIGIN)
      .set('X-Forwarded-For', '192.0.2.2')
      .send({
        identifier: 'admin_inspector',
        password: 'adminPassword123',
      });
    const adminCookie = extractCookie(adminLoginRes.headers);

    const adminRes = await request
      .get('/api/v1/users/target_score_user')
      .set('Cookie', adminCookie);
    expect(adminRes.status).toBe(200);
    expect(adminRes.body.q).toBe('3.500'); // Visible to admin!

    // 5. Another normal user cannot see q
    const _other = await createUser({
      username: 'other_normal_user',
      email: 'other@example.com',
      password: 'otherPassword123',
      displayName: 'Other User',
    });
    const otherLoginRes = await request
      .post('/api/v1/auth/login')
      .set('Origin', config.APP_ORIGIN)
      .set('X-Forwarded-For', '192.0.2.3')
      .send({
        identifier: 'other_normal_user',
        password: 'otherPassword123',
      });
    const otherCookie = extractCookie(otherLoginRes.headers);

    const otherRes = await request
      .get('/api/v1/users/target_score_user')
      .set('Cookie', otherCookie);
    expect(otherRes.status).toBe(200);
    expect(otherRes.body.q).toBeUndefined(); // Hidden from other regular user

    // 6. If PUBLIC_SCORE_VISIBILITY = 'full', q is visible publicly
    config.PUBLIC_SCORE_VISIBILITY = 'full';
    const publicRes = await request.get('/api/v1/users/target_score_user');
    expect(publicRes.status).toBe(200);
    expect(publicRes.body.q).toBe('3.500'); // Visible to all under 'full'

    // Reset config
    config.PUBLIC_SCORE_VISIBILITY = 'tier_only';
  });

  it('GET /users/:username reflects follows and blocks viewer relationships', async () => {
    const pool = getTestPool();

    const u1 = await createUser({
      username: 'user_u1',
      email: 'u1@example.com',
      password: 'password12345',
      displayName: 'User 1',
    });

    const u2 = await createUser({
      username: 'user_u2',
      email: 'u2@example.com',
      password: 'password12345',
      displayName: 'User 2',
    });

    // Login as u1
    const loginU1 = await request
      .post('/api/v1/auth/login')
      .set('Origin', config.APP_ORIGIN)
      .set('X-Forwarded-For', '192.0.2.10')
      .send({ identifier: 'user_u1', password: 'password12345' });
    const cookieU1 = extractCookie(loginU1.headers);

    // Initial check: not following, not blocked
    const initRes = await request.get('/api/v1/users/user_u2').set('Cookie', cookieU1);
    expect(initRes.status).toBe(200);
    expect(initRes.body.viewer).toEqual({ following: false, blocked: false });
    expect(initRes.body.counts).toEqual({ posts: 0, followers: 0, following: 0 });

    // U1 follows U2
    await pool.query(`INSERT INTO follows (follower_id, followee_id) VALUES ($1, $2)`, [
      u1.id,
      u2.id,
    ]);

    const followRes = await request.get('/api/v1/users/user_u2').set('Cookie', cookieU1);
    expect(followRes.status).toBe(200);
    expect(followRes.body.viewer.following).toBe(true);
    expect(followRes.body.viewer.blocked).toBe(false);
    expect(followRes.body.counts.followers).toBe(1);

    // U2 blocks U1
    await pool.query(`INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)`, [u2.id, u1.id]);

    const blockRes = await request.get('/api/v1/users/user_u2').set('Cookie', cookieU1);
    expect(blockRes.status).toBe(200);
    expect(blockRes.body.viewer.blocked).toBe(true);
  });

  it('PATCH /users/me rejects unauthenticated, unverified, and suspended users', async () => {
    // 1. Unauthenticated -> 401
    const unauthRes = await request
      .patch('/api/v1/users/me')
      .set('Origin', config.APP_ORIGIN)
      .send({ displayName: 'Hacker' });
    expect(unauthRes.status).toBe(401);
    expect(unauthRes.body.error.code).toBe('UNAUTHENTICATED');

    // 2. Suspended user -> 403 ACCOUNT_SUSPENDED
    const suspended = await createUser({
      username: 'suspended_guy',
      email: 'suspended@example.com',
      password: 'password12345',
      displayName: 'Suspended Guy',
    });
    const pool = getTestPool();
    await pool.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [suspended.id]);

    const suspendedLogin = await request
      .post('/api/v1/auth/login')
      .set('Origin', config.APP_ORIGIN)
      .set('X-Forwarded-For', '192.0.2.21')
      .send({ identifier: 'suspended_guy', password: 'password12345' });
    const suspendedCookie = extractCookie(suspendedLogin.headers);

    const suspRes = await request
      .patch('/api/v1/users/me')
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', suspendedCookie)
      .send({ displayName: 'New Name' });
    expect(suspRes.status).toBe(403);
    expect(suspRes.body.error.code).toBe('ACCOUNT_SUSPENDED');
  });

  it('PATCH /users/me strictly rejects forbidden fields', async () => {
    const _user = await createUser({
      username: 'strict_user',
      email: 'strict@example.com',
      password: 'password12345',
      displayName: 'Strict User',
    });
    const loginRes = await request
      .post('/api/v1/auth/login')
      .set('Origin', config.APP_ORIGIN)
      .set('X-Forwarded-For', '192.0.2.30')
      .send({ identifier: 'strict_user', password: 'password12345' });
    const cookie = extractCookie(loginRes.headers);

    // Attempting to modify role
    const roleRes = await request
      .patch('/api/v1/users/me')
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', cookie)
      .send({ role: 'admin' });
    expect(roleRes.status).toBe(400);
    expect(roleRes.body.error.code).toBe('VALIDATION_ERROR');

    // Attempting to modify sigma
    const sigmaRes = await request
      .patch('/api/v1/users/me')
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', cookie)
      .send({ sigma: 0.9 });
    expect(sigmaRes.status).toBe(400);
    expect(sigmaRes.body.error.code).toBe('VALIDATION_ERROR');

    // Attempting to modify email or username
    const emailRes = await request
      .patch('/api/v1/users/me')
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', cookie)
      .send({ email: 'newemail@example.com' });
    expect(emailRes.status).toBe(400);
    expect(emailRes.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('PATCH /users/me updates displayName, bio, and avatarMediaId', async () => {
    const pool = getTestPool();

    const user = await createUser({
      username: 'patch_user',
      email: 'patch@example.com',
      password: 'password12345',
      displayName: 'Before Patch',
    });
    const loginRes = await request
      .post('/api/v1/auth/login')
      .set('Origin', config.APP_ORIGIN)
      .set('X-Forwarded-For', '192.0.2.40')
      .send({ identifier: 'patch_user', password: 'password12345' });
    const cookie = extractCookie(loginRes.headers);

    // 1. Update displayName and bio
    const updateRes = await request
      .patch('/api/v1/users/me')
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', cookie)
      .send({
        displayName: 'After Patch',
        bio: 'This is my updated bio.',
      });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.user.displayName).toBe('After Patch');
    expect(updateRes.body.user.bio).toBe('This is my updated bio.');
    expect(updateRes.body.user.avatarUrl).toBeNull();

    // 2. Non-existent avatarMediaId fails
    const badMediaRes = await request
      .patch('/api/v1/users/me')
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', cookie)
      .send({
        avatarMediaId: '00000000-0000-0000-0000-000000000000',
      });
    expect(badMediaRes.status).toBe(400);
    expect(badMediaRes.body.error.code).toBe('VALIDATION_ERROR');

    // 3. Create real media row in database and set avatarMediaId
    const mediaRow = await pool.query(
      `INSERT INTO media (
        owner_id, kind, object_key, content_type, bytes, width, height
      ) VALUES (
        $1, 'avatar', 'avatars/test.webp', 'image/webp', 1234, 200, 200
      ) RETURNING id`,
      [user.id],
    );
    const mediaId = mediaRow.rows[0].id;

    const goodMediaRes = await request
      .patch('/api/v1/users/me')
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', cookie)
      .send({ avatarMediaId: mediaId });
    expect(goodMediaRes.status).toBe(200);
    expect(goodMediaRes.body.user.avatarUrl).toBe(`${config.S3_PUBLIC_BASE_URL}/${mediaId}`);
  });
});
