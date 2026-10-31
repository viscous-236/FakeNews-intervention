/**
 * apps/api/test/api/authz-matrix.test.ts (TASK-047, TEST-105)
 *
 * Authorization Matrix Integration Test for every Phase 5 endpoint across all 5 caller states:
 *   1. Unauthenticated (no session cookie)
 *   2. Unverified (authenticated, email_verified_at = NULL, status = active, role = user)
 *   3. Suspended (authenticated, email_verified_at != NULL, status = suspended, role = user)
 *   4. Verified (authenticated, email_verified_at != NULL, status = active, role = user)
 *   5. Admin (authenticated, email_verified_at != NULL, status = active, role = admin)
 *
 * Covers:
 *   - 6 Act Endpoints (requireActive):
 *       PATCH /api/v1/users/me
 *       POST  /api/v1/posts
 *       PATCH /api/v1/posts/:id
 *       DELETE /api/v1/posts/:id
 *       POST  /api/v1/media
 *       POST  /api/v1/events/:id/appeal
 *   - 18 Auth Endpoints (requireAuth):
 *       POST   /api/v1/auth/logout
 *       GET    /api/v1/auth/me
 *       POST   /api/v1/auth/resend-verification
 *       POST   /api/v1/auth/change-password
 *       GET    /api/v1/auth/sessions
 *       DELETE /api/v1/auth/sessions/:id
 *       DELETE /api/v1/users/me
 *       GET    /api/v1/users/me/export
 *       GET    /api/v1/feed/following
 *       GET    /api/v1/me/score
 *       GET    /api/v1/me/score/history
 *       GET    /api/v1/me/score/history/:waveNumber
 *       GET    /api/v1/me/events
 *       GET    /api/v1/me/appeals
 *       GET    /api/v1/notifications
 *       GET    /api/v1/notifications/unread-count
 *       POST   /api/v1/notifications/read
 *       GET    /api/v1/notifications/stream
 *   - 11 Pub Endpoints (Public):
 *       POST /api/v1/auth/register
 *       POST /api/v1/auth/login
 *       POST /api/v1/auth/verify-email
 *       POST /api/v1/auth/forgot-password
 *       POST /api/v1/auth/reset-password
 *       GET  /api/v1/users/:username
 *       GET  /api/v1/users/:username/posts
 *       GET  /api/v1/posts/:id
 *       GET  /api/v1/feed/global
 *       GET  /api/v1/users/:username/score
 *       GET  /api/v1/waves/current
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import crypto from 'crypto';
import http from 'http';
import sharp from 'sharp';
import { createApp } from '../../src/app.js';
import { config } from '../../src/config.js';
import { getTestPool, closeTestPool, truncateAll } from '../setup/db.js';
import { createUser } from '../../src/modules/users/service.js';
import { ensureBucketExists } from '../../src/storage/s3.js';

describe('Authorization Matrix (TASK-047, TEST-105)', () => {
  const app = createApp();
  const request = supertest(app);

  let ipCounter = 1;
  function nextIp(): string {
    const o3 = Math.floor(ipCounter / 250);
    const o4 = (ipCounter % 250) + 1;
    ipCounter += 1;
    return `10.240.${o3}.${o4}`;
  }

  // Common users for read/non-destructive tests
  let unverifiedUserId: string;
  let suspendedUserId: string;
  let verifiedUserId: string;
  let adminUserId: string;

  let publicAuthorId: string;
  let publicUsername: string;
  let publicPostId: string;

  let testPngBuffer: Buffer;

  // Session helper
  async function createSessionCookie(userId: string): Promise<string> {
    const rawToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const pool = getTestPool();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await pool.query(
      `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
      [userId, tokenHash, expiresAt],
    );
    return `${config.SESSION_COOKIE_NAME}=${rawToken}`;
  }

  beforeAll(async () => {
    await truncateAll();
    await ensureBucketExists();

    testPngBuffer = await sharp({
      create: { width: 10, height: 10, channels: 3, background: { r: 255, g: 0, b: 0 } },
    })
      .png()
      .toBuffer();

    // 1. Unverified user
    const unverifiedUser = await createUser({
      username: 'u_unverified',
      email: 'unverified@matrix.local',
      password: 'password12345',
      displayName: 'Unverified User',
      emailVerified: false,
    });
    unverifiedUserId = unverifiedUser.id;

    // 2. Suspended user
    const suspendedUser = await createUser({
      username: 'u_suspended',
      email: 'suspended@matrix.local',
      password: 'password12345',
      displayName: 'Suspended User',
      emailVerified: true,
    });
    suspendedUserId = suspendedUser.id;
    const pool = getTestPool();
    await pool.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [suspendedUserId]);

    // 3. Verified user
    const verifiedUser = await createUser({
      username: 'u_verified',
      email: 'verified@matrix.local',
      password: 'password12345',
      displayName: 'Verified User',
      emailVerified: true,
    });
    verifiedUserId = verifiedUser.id;

    // 4. Admin user
    const adminUser = await createUser({
      username: 'u_admin',
      email: 'admin@matrix.local',
      password: 'password12345',
      displayName: 'Admin User',
      role: 'admin',
      emailVerified: true,
    });
    adminUserId = adminUser.id;

    // 5. Public author and post for public endpoint tests
    const pubAuthor = await createUser({
      username: 'pub_author',
      email: 'pub_author@matrix.local',
      password: 'password12345',
      displayName: 'Public Author',
      emailVerified: true,
    });
    publicAuthorId = pubAuthor.id;
    publicUsername = pubAuthor.username;

    const postIns = await pool.query<{ id: string }>(
      `INSERT INTO posts (author_id, kind, body, status, author_tier_at_post)
       VALUES ($1, 'original', 'This is a public post with enough characters for validation', 'published', 'neutral')
       RETURNING id`,
      [publicAuthorId],
    );
    publicPostId = postIns.rows[0]!.id;
  });

  afterAll(async () => {
    await closeTestPool();
  });

  // =========================================================================
  // SECTION 1: Act Endpoints (requireActive)
  //   Unauthenticated -> 401 UNAUTHENTICATED
  //   Unverified      -> 403 EMAIL_NOT_VERIFIED
  //   Suspended       -> 403 ACCOUNT_SUSPENDED
  //   Verified        -> Allowed (2xx)
  //   Admin           -> Allowed (2xx)
  // =========================================================================
  describe('Act Endpoints (requireActive)', () => {
    // -----------------------------------------------------------------------
    // 1. PATCH /api/v1/users/me
    // -----------------------------------------------------------------------
    describe('PATCH /api/v1/users/me', () => {
      it('unauthenticated -> 401 UNAUTHENTICATED', async () => {
        const res = await request
          .patch('/api/v1/users/me')
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp())
          .send({ displayName: 'Hacker' });
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('UNAUTHENTICATED');
      });

      it('unverified -> 403 EMAIL_NOT_VERIFIED', async () => {
        const cookie = await createSessionCookie(unverifiedUserId);
        const res = await request
          .patch('/api/v1/users/me')
          .set('Cookie', cookie)
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp())
          .send({ displayName: 'New Name' });
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
      });

      it('suspended -> 403 ACCOUNT_SUSPENDED', async () => {
        const cookie = await createSessionCookie(suspendedUserId);
        const res = await request
          .patch('/api/v1/users/me')
          .set('Cookie', cookie)
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp())
          .send({ displayName: 'New Name' });
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('ACCOUNT_SUSPENDED');
      });

      it('verified -> 200 OK', async () => {
        const cookie = await createSessionCookie(verifiedUserId);
        const res = await request
          .patch('/api/v1/users/me')
          .set('Cookie', cookie)
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp())
          .send({ displayName: 'Updated Verified' });
        expect(res.status).toBe(200);
        expect(res.body.user.displayName).toBe('Updated Verified');
      });

      it('admin -> 200 OK', async () => {
        const cookie = await createSessionCookie(adminUserId);
        const res = await request
          .patch('/api/v1/users/me')
          .set('Cookie', cookie)
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp())
          .send({ displayName: 'Updated Admin' });
        expect(res.status).toBe(200);
        expect(res.body.user.displayName).toBe('Updated Admin');
      });
    });

    // -----------------------------------------------------------------------
    // 2. POST /api/v1/posts
    // -----------------------------------------------------------------------
    describe('POST /api/v1/posts', () => {
      const validPostPayload = {
        body: 'This is a brand new post written for authorization matrix testing',
      };

      it('unauthenticated -> 401 UNAUTHENTICATED', async () => {
        const res = await request
          .post('/api/v1/posts')
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp())
          .send(validPostPayload);
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('UNAUTHENTICATED');
      });

      it('unverified -> 403 EMAIL_NOT_VERIFIED', async () => {
        const cookie = await createSessionCookie(unverifiedUserId);
        const res = await request
          .post('/api/v1/posts')
          .set('Cookie', cookie)
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp())
          .send(validPostPayload);
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
      });

      it('suspended -> 403 ACCOUNT_SUSPENDED', async () => {
        const cookie = await createSessionCookie(suspendedUserId);
        const res = await request
          .post('/api/v1/posts')
          .set('Cookie', cookie)
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp())
          .send(validPostPayload);
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('ACCOUNT_SUSPENDED');
      });

      it('verified -> 201 CREATED', async () => {
        const cookie = await createSessionCookie(verifiedUserId);
        const res = await request
          .post('/api/v1/posts')
          .set('Cookie', cookie)
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp())
          .send(validPostPayload);
        expect(res.status).toBe(201);
        expect(res.body.id).toBeDefined();
      });

      it('admin -> 201 CREATED', async () => {
        const cookie = await createSessionCookie(adminUserId);
        const res = await request
          .post('/api/v1/posts')
          .set('Cookie', cookie)
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp())
          .send(validPostPayload);
        expect(res.status).toBe(201);
        expect(res.body.id).toBeDefined();
      });
    });

    // -----------------------------------------------------------------------
    // 3. PATCH /api/v1/posts/:id
    // -----------------------------------------------------------------------
    describe('PATCH /api/v1/posts/:id', () => {
      let verifiedPostId: string;
      let adminPostId: string;

      beforeAll(async () => {
        const pool = getTestPool();
        const vRes = await pool.query<{ id: string }>(
          `INSERT INTO posts (author_id, kind, body, status, author_tier_at_post)
           VALUES ($1, 'original', 'Post created for verified user patch testing', 'published', 'neutral')
           RETURNING id`,
          [verifiedUserId],
        );
        verifiedPostId = vRes.rows[0]!.id;

        const aRes = await pool.query<{ id: string }>(
          `INSERT INTO posts (author_id, kind, body, status, author_tier_at_post)
           VALUES ($1, 'original', 'Post created for admin user patch testing', 'published', 'neutral')
           RETURNING id`,
          [adminUserId],
        );
        adminPostId = aRes.rows[0]!.id;
      });

      it('unauthenticated -> 401 UNAUTHENTICATED', async () => {
        const res = await request
          .patch(`/api/v1/posts/${verifiedPostId}`)
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp())
          .send({ body: 'Updated body for unauthenticated caller' });
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('UNAUTHENTICATED');
      });

      it('unverified -> 403 EMAIL_NOT_VERIFIED', async () => {
        const cookie = await createSessionCookie(unverifiedUserId);
        const res = await request
          .patch(`/api/v1/posts/${verifiedPostId}`)
          .set('Cookie', cookie)
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp())
          .send({ body: 'Updated body for unverified caller' });
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
      });

      it('suspended -> 403 ACCOUNT_SUSPENDED', async () => {
        const cookie = await createSessionCookie(suspendedUserId);
        const res = await request
          .patch(`/api/v1/posts/${verifiedPostId}`)
          .set('Cookie', cookie)
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp())
          .send({ body: 'Updated body for suspended caller' });
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('ACCOUNT_SUSPENDED');
      });

      it('verified -> 200 OK (own post)', async () => {
        const cookie = await createSessionCookie(verifiedUserId);
        const res = await request
          .patch(`/api/v1/posts/${verifiedPostId}`)
          .set('Cookie', cookie)
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp())
          .send({ body: 'Updated body by author verified user' });
        expect(res.status).toBe(200);
        expect(res.body.body).toBe('Updated body by author verified user');
      });

      it('admin -> 200 OK (own post)', async () => {
        const cookie = await createSessionCookie(adminUserId);
        const res = await request
          .patch(`/api/v1/posts/${adminPostId}`)
          .set('Cookie', cookie)
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp())
          .send({ body: 'Updated body by author admin user' });
        expect(res.status).toBe(200);
        expect(res.body.body).toBe('Updated body by author admin user');
      });
    });

    // -----------------------------------------------------------------------
    // 4. DELETE /api/v1/posts/:id
    // -----------------------------------------------------------------------
    describe('DELETE /api/v1/posts/:id', () => {
      it('unauthenticated -> 401 UNAUTHENTICATED', async () => {
        const res = await request
          .delete(`/api/v1/posts/${publicPostId}`)
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('UNAUTHENTICATED');
      });

      it('unverified -> 403 EMAIL_NOT_VERIFIED', async () => {
        const cookie = await createSessionCookie(unverifiedUserId);
        const res = await request
          .delete(`/api/v1/posts/${publicPostId}`)
          .set('Cookie', cookie)
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
      });

      it('suspended -> 403 ACCOUNT_SUSPENDED', async () => {
        const cookie = await createSessionCookie(suspendedUserId);
        const res = await request
          .delete(`/api/v1/posts/${publicPostId}`)
          .set('Cookie', cookie)
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('ACCOUNT_SUSPENDED');
      });

      it('verified -> 204 No Content (own post)', async () => {
        const pool = getTestPool();
        const post = await pool.query<{ id: string }>(
          `INSERT INTO posts (author_id, kind, body, status, author_tier_at_post)
           VALUES ($1, 'original', 'Post to be deleted by verified owner', 'published', 'neutral')
           RETURNING id`,
          [verifiedUserId],
        );
        const cookie = await createSessionCookie(verifiedUserId);
        const res = await request
          .delete(`/api/v1/posts/${post.rows[0]!.id}`)
          .set('Cookie', cookie)
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(204);
      });

      it('admin -> 204 No Content (own post)', async () => {
        const pool = getTestPool();
        const post = await pool.query<{ id: string }>(
          `INSERT INTO posts (author_id, kind, body, status, author_tier_at_post)
           VALUES ($1, 'original', 'Post to be deleted by admin owner', 'published', 'neutral')
           RETURNING id`,
          [adminUserId],
        );
        const cookie = await createSessionCookie(adminUserId);
        const res = await request
          .delete(`/api/v1/posts/${post.rows[0]!.id}`)
          .set('Cookie', cookie)
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(204);
      });
    });

    // -----------------------------------------------------------------------
    // 5. POST /api/v1/media
    // -----------------------------------------------------------------------
    describe('POST /api/v1/media', () => {
      it('unauthenticated -> 401 UNAUTHENTICATED', async () => {
        const res = await request
          .post('/api/v1/media')
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp())
          .field('kind', 'avatar')
          .attach('file', testPngBuffer, 'test.png');
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('UNAUTHENTICATED');
      });

      it('unverified -> 403 EMAIL_NOT_VERIFIED', async () => {
        const cookie = await createSessionCookie(unverifiedUserId);
        const res = await request
          .post('/api/v1/media')
          .set('Cookie', cookie)
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp())
          .field('kind', 'avatar')
          .attach('file', testPngBuffer, 'test.png');
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
      });

      it('suspended -> 403 ACCOUNT_SUSPENDED', async () => {
        const cookie = await createSessionCookie(suspendedUserId);
        const res = await request
          .post('/api/v1/media')
          .set('Cookie', cookie)
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp())
          .field('kind', 'avatar')
          .attach('file', testPngBuffer, 'test.png');
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('ACCOUNT_SUSPENDED');
      });

      it('verified -> 201 CREATED', async () => {
        const cookie = await createSessionCookie(verifiedUserId);
        const res = await request
          .post('/api/v1/media')
          .set('Cookie', cookie)
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp())
          .field('kind', 'avatar')
          .attach('file', testPngBuffer, 'test.png');
        expect(res.status).toBe(201);
        expect(res.body.id).toBeDefined();
        expect(res.body.url).toBeDefined();
      });

      it('admin -> 201 CREATED', async () => {
        const cookie = await createSessionCookie(adminUserId);
        const res = await request
          .post('/api/v1/media')
          .set('Cookie', cookie)
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp())
          .field('kind', 'post_image')
          .attach('file', testPngBuffer, 'test.png');
        expect(res.status).toBe(201);
        expect(res.body.id).toBeDefined();
      });
    });

    // -----------------------------------------------------------------------
    // 6. POST /api/v1/events/:id/appeal
    // -----------------------------------------------------------------------
    describe('POST /api/v1/events/:id/appeal', () => {
      let verifiedEventId: string;
      let adminEventId: string;

      beforeAll(async () => {
        const pool = getTestPool();
        const openWave = await pool.query<{ id: string }>(
          `SELECT id FROM waves WHERE status = 'open' LIMIT 1`,
        );
        const waveId = openWave.rows[0]!.id;

        // Post and assessment for verified user's event
        const p1 = await pool.query<{ id: string }>(
          `INSERT INTO posts (author_id, kind, body, status, author_tier_at_post)
           VALUES ($1, 'original', 'Post for verified negative event appeal testing', 'published', 'neutral')
           RETURNING id`,
          [verifiedUserId],
        );
        const a1 = await pool.query<{ id: string }>(
          `INSERT INTO assessments (post_id, post_revision, verdict, source, decided_by, rationale, is_current)
           VALUES ($1, 1, 'fake', 'admin', $2, 'Assessment rationale for appeal test', true)
           RETURNING id`,
          [p1.rows[0]!.id, adminUserId],
        );
        const e1 = await pool.query<{ id: string }>(
          `INSERT INTO reputation_events (user_id, post_id, assessment_id, kind, value, status, wave_id)
           VALUES ($1, $2, $3, 'MISINFO_POST', -1, 'eligible', $4)
           RETURNING id`,
          [verifiedUserId, p1.rows[0]!.id, a1.rows[0]!.id, waveId],
        );
        verifiedEventId = e1.rows[0]!.id;

        // Post and assessment for admin user's event
        const p2 = await pool.query<{ id: string }>(
          `INSERT INTO posts (author_id, kind, body, status, author_tier_at_post)
           VALUES ($1, 'original', 'Post for admin negative event appeal testing', 'published', 'neutral')
           RETURNING id`,
          [adminUserId],
        );
        const a2 = await pool.query<{ id: string }>(
          `INSERT INTO assessments (post_id, post_revision, verdict, source, decided_by, rationale, is_current)
           VALUES ($1, 1, 'fake', 'admin', $2, 'Assessment rationale for admin test', true)
           RETURNING id`,
          [p2.rows[0]!.id, adminUserId],
        );
        const e2 = await pool.query<{ id: string }>(
          `INSERT INTO reputation_events (user_id, post_id, assessment_id, kind, value, status, wave_id)
           VALUES ($1, $2, $3, 'MISINFO_POST', -1, 'eligible', $4)
           RETURNING id`,
          [adminUserId, p2.rows[0]!.id, a2.rows[0]!.id, waveId],
        );
        adminEventId = e2.rows[0]!.id;
      });

      const appealPayload = {
        reason: 'This is a genuine mistake and valid justification for my appeal',
      };

      it('unauthenticated -> 401 UNAUTHENTICATED', async () => {
        const res = await request
          .post(`/api/v1/events/${verifiedEventId}/appeal`)
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp())
          .send(appealPayload);
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('UNAUTHENTICATED');
      });

      it('unverified -> 403 EMAIL_NOT_VERIFIED', async () => {
        const cookie = await createSessionCookie(unverifiedUserId);
        const res = await request
          .post(`/api/v1/events/${verifiedEventId}/appeal`)
          .set('Cookie', cookie)
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp())
          .send(appealPayload);
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
      });

      it('suspended -> 403 ACCOUNT_SUSPENDED', async () => {
        const cookie = await createSessionCookie(suspendedUserId);
        const res = await request
          .post(`/api/v1/events/${verifiedEventId}/appeal`)
          .set('Cookie', cookie)
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp())
          .send(appealPayload);
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('ACCOUNT_SUSPENDED');
      });

      it('verified -> 201 CREATED', async () => {
        const cookie = await createSessionCookie(verifiedUserId);
        const res = await request
          .post(`/api/v1/events/${verifiedEventId}/appeal`)
          .set('Cookie', cookie)
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp())
          .send(appealPayload);
        expect(res.status).toBe(201);
        expect(res.body.status).toBe('open');
      });

      it('admin -> 201 CREATED', async () => {
        const cookie = await createSessionCookie(adminUserId);
        const res = await request
          .post(`/api/v1/events/${adminEventId}/appeal`)
          .set('Cookie', cookie)
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp())
          .send(appealPayload);
        expect(res.status).toBe(201);
        expect(res.body.status).toBe('open');
      });
    });
  });

  // =========================================================================
  // SECTION 2: Auth Endpoints (requireAuth)
  //   Unauthenticated -> 401 UNAUTHENTICATED
  //   Unverified      -> Allowed (2xx)
  //   Suspended       -> Allowed (2xx)
  //   Verified        -> Allowed (2xx)
  //   Admin           -> Allowed (2xx)
  // =========================================================================
  describe('Auth Endpoints (requireAuth)', () => {
    // -----------------------------------------------------------------------
    // 7. POST /api/v1/auth/logout
    // -----------------------------------------------------------------------
    describe('POST /api/v1/auth/logout', () => {
      it('unauthenticated -> 401 UNAUTHENTICATED', async () => {
        const res = await request
          .post('/api/v1/auth/logout')
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('UNAUTHENTICATED');
      });

      it('unverified -> 204 No Content', async () => {
        const cookie = await createSessionCookie(unverifiedUserId);
        const res = await request
          .post('/api/v1/auth/logout')
          .set('Cookie', cookie)
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(204);
      });

      it('suspended -> 204 No Content', async () => {
        const cookie = await createSessionCookie(suspendedUserId);
        const res = await request
          .post('/api/v1/auth/logout')
          .set('Cookie', cookie)
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(204);
      });

      it('verified -> 204 No Content', async () => {
        const cookie = await createSessionCookie(verifiedUserId);
        const res = await request
          .post('/api/v1/auth/logout')
          .set('Cookie', cookie)
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(204);
      });

      it('admin -> 204 No Content', async () => {
        const cookie = await createSessionCookie(adminUserId);
        const res = await request
          .post('/api/v1/auth/logout')
          .set('Cookie', cookie)
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(204);
      });
    });

    // -----------------------------------------------------------------------
    // 8. GET /api/v1/auth/me
    // -----------------------------------------------------------------------
    describe('GET /api/v1/auth/me', () => {
      it('unauthenticated -> 401 UNAUTHENTICATED', async () => {
        const res = await request
          .get('/api/v1/auth/me')
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('UNAUTHENTICATED');
      });

      it('unverified -> 200 OK', async () => {
        const cookie = await createSessionCookie(unverifiedUserId);
        const res = await request
          .get('/api/v1/auth/me')
          .set('Cookie', cookie)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(200);
        expect(res.body.user.emailVerified).toBe(false);
      });

      it('suspended -> 200 OK', async () => {
        const cookie = await createSessionCookie(suspendedUserId);
        const res = await request
          .get('/api/v1/auth/me')
          .set('Cookie', cookie)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(200);
        expect(res.body.user.status).toBe('suspended');
      });

      it('verified -> 200 OK', async () => {
        const cookie = await createSessionCookie(verifiedUserId);
        const res = await request
          .get('/api/v1/auth/me')
          .set('Cookie', cookie)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(200);
        expect(res.body.user.emailVerified).toBe(true);
      });

      it('admin -> 200 OK', async () => {
        const cookie = await createSessionCookie(adminUserId);
        const res = await request
          .get('/api/v1/auth/me')
          .set('Cookie', cookie)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(200);
        expect(res.body.user.role).toBe('admin');
      });
    });

    // -----------------------------------------------------------------------
    // 9. POST /api/v1/auth/resend-verification
    // -----------------------------------------------------------------------
    describe('POST /api/v1/auth/resend-verification', () => {
      it('unauthenticated -> 401 UNAUTHENTICATED', async () => {
        const res = await request
          .post('/api/v1/auth/resend-verification')
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('UNAUTHENTICATED');
      });

      it('unverified -> 204 No Content', async () => {
        const cookie = await createSessionCookie(unverifiedUserId);
        const res = await request
          .post('/api/v1/auth/resend-verification')
          .set('Cookie', cookie)
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(204);
      });

      it('suspended -> 204 No Content', async () => {
        const cookie = await createSessionCookie(suspendedUserId);
        const res = await request
          .post('/api/v1/auth/resend-verification')
          .set('Cookie', cookie)
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(204);
      });

      it('verified -> 204 No Content', async () => {
        const cookie = await createSessionCookie(verifiedUserId);
        const res = await request
          .post('/api/v1/auth/resend-verification')
          .set('Cookie', cookie)
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(204);
      });

      it('admin -> 204 No Content', async () => {
        const cookie = await createSessionCookie(adminUserId);
        const res = await request
          .post('/api/v1/auth/resend-verification')
          .set('Cookie', cookie)
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(204);
      });
    });

    // -----------------------------------------------------------------------
    // 10. POST /api/v1/auth/change-password
    // -----------------------------------------------------------------------
    describe('POST /api/v1/auth/change-password', () => {
      it('unauthenticated -> 401 UNAUTHENTICATED', async () => {
        const res = await request
          .post('/api/v1/auth/change-password')
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp())
          .send({ currentPassword: 'password12345', newPassword: 'newpassword123' });
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('UNAUTHENTICATED');
      });

      it('unverified -> 204 No Content', async () => {
        const u = await createUser({
          username: 'chpass_unver',
          email: 'chpass_unver@matrix.local',
          password: 'password12345',
          displayName: 'Change Pass Unver',
          emailVerified: false,
        });
        const cookie = await createSessionCookie(u.id);
        const res = await request
          .post('/api/v1/auth/change-password')
          .set('Cookie', cookie)
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp())
          .send({ currentPassword: 'password12345', newPassword: 'newpassword123' });
        expect(res.status).toBe(204);
      });

      it('suspended -> 204 No Content', async () => {
        const u = await createUser({
          username: 'chpass_susp',
          email: 'chpass_susp@matrix.local',
          password: 'password12345',
          displayName: 'Change Pass Susp',
          emailVerified: true,
        });
        const pool = getTestPool();
        await pool.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [u.id]);
        const cookie = await createSessionCookie(u.id);
        const res = await request
          .post('/api/v1/auth/change-password')
          .set('Cookie', cookie)
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp())
          .send({ currentPassword: 'password12345', newPassword: 'newpassword123' });
        expect(res.status).toBe(204);
      });

      it('verified -> 204 No Content', async () => {
        const u = await createUser({
          username: 'chpass_ver',
          email: 'chpass_ver@matrix.local',
          password: 'password12345',
          displayName: 'Change Pass Ver',
          emailVerified: true,
        });
        const cookie = await createSessionCookie(u.id);
        const res = await request
          .post('/api/v1/auth/change-password')
          .set('Cookie', cookie)
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp())
          .send({ currentPassword: 'password12345', newPassword: 'newpassword123' });
        expect(res.status).toBe(204);
      });

      it('admin -> 204 No Content', async () => {
        const u = await createUser({
          username: 'chpass_adm',
          email: 'chpass_adm@matrix.local',
          password: 'password12345',
          displayName: 'Change Pass Admin',
          role: 'admin',
          emailVerified: true,
        });
        const cookie = await createSessionCookie(u.id);
        const res = await request
          .post('/api/v1/auth/change-password')
          .set('Cookie', cookie)
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp())
          .send({ currentPassword: 'password12345', newPassword: 'newpassword123' });
        expect(res.status).toBe(204);
      });
    });

    // -----------------------------------------------------------------------
    // 11. GET /api/v1/auth/sessions
    // -----------------------------------------------------------------------
    describe('GET /api/v1/auth/sessions', () => {
      it('unauthenticated -> 401 UNAUTHENTICATED', async () => {
        const res = await request
          .get('/api/v1/auth/sessions')
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('UNAUTHENTICATED');
      });

      it('unverified -> 200 OK', async () => {
        const cookie = await createSessionCookie(unverifiedUserId);
        const res = await request
          .get('/api/v1/auth/sessions')
          .set('Cookie', cookie)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
      });

      it('suspended -> 200 OK', async () => {
        const cookie = await createSessionCookie(suspendedUserId);
        const res = await request
          .get('/api/v1/auth/sessions')
          .set('Cookie', cookie)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
      });

      it('verified -> 200 OK', async () => {
        const cookie = await createSessionCookie(verifiedUserId);
        const res = await request
          .get('/api/v1/auth/sessions')
          .set('Cookie', cookie)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
      });

      it('admin -> 200 OK', async () => {
        const cookie = await createSessionCookie(adminUserId);
        const res = await request
          .get('/api/v1/auth/sessions')
          .set('Cookie', cookie)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
      });
    });

    // -----------------------------------------------------------------------
    // 12. DELETE /api/v1/auth/sessions/:id
    // -----------------------------------------------------------------------
    describe('DELETE /api/v1/auth/sessions/:id', () => {
      async function createSecondarySession(userId: string): Promise<string> {
        const rawToken = crypto.randomBytes(32).toString('base64url');
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
        const pool = getTestPool();
        const res = await pool.query<{ id: string }>(
          `INSERT INTO sessions (user_id, token_hash, expires_at)
           VALUES ($1, $2, now() + interval '1 day')
           RETURNING id`,
          [userId, tokenHash],
        );
        return res.rows[0]!.id;
      }

      it('unauthenticated -> 401 UNAUTHENTICATED', async () => {
        const res = await request
          .delete('/api/v1/auth/sessions/00000000-0000-0000-0000-000000000000')
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('UNAUTHENTICATED');
      });

      it('unverified -> 204 No Content (own session)', async () => {
        const sessionId = await createSecondarySession(unverifiedUserId);
        const cookie = await createSessionCookie(unverifiedUserId);
        const res = await request
          .delete(`/api/v1/auth/sessions/${sessionId}`)
          .set('Cookie', cookie)
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(204);
      });

      it('suspended -> 204 No Content (own session)', async () => {
        const sessionId = await createSecondarySession(suspendedUserId);
        const cookie = await createSessionCookie(suspendedUserId);
        const res = await request
          .delete(`/api/v1/auth/sessions/${sessionId}`)
          .set('Cookie', cookie)
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(204);
      });

      it('verified -> 204 No Content (own session)', async () => {
        const sessionId = await createSecondarySession(verifiedUserId);
        const cookie = await createSessionCookie(verifiedUserId);
        const res = await request
          .delete(`/api/v1/auth/sessions/${sessionId}`)
          .set('Cookie', cookie)
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(204);
      });

      it('admin -> 204 No Content (own session)', async () => {
        const sessionId = await createSecondarySession(adminUserId);
        const cookie = await createSessionCookie(adminUserId);
        const res = await request
          .delete(`/api/v1/auth/sessions/${sessionId}`)
          .set('Cookie', cookie)
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(204);
      });
    });

    // -----------------------------------------------------------------------
    // 13. DELETE /api/v1/users/me
    // -----------------------------------------------------------------------
    describe('DELETE /api/v1/users/me', () => {
      it('unauthenticated -> 401 UNAUTHENTICATED', async () => {
        const res = await request
          .delete('/api/v1/users/me')
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp())
          .send({ password: 'password12345' });
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('UNAUTHENTICATED');
      });

      it('unverified -> 204 No Content', async () => {
        const u = await createUser({
          username: 'del_unverified',
          email: 'del_unverified@matrix.local',
          password: 'password12345',
          displayName: 'Del Unverified',
          emailVerified: false,
        });
        const cookie = await createSessionCookie(u.id);
        const res = await request
          .delete('/api/v1/users/me')
          .set('Cookie', cookie)
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp())
          .send({ password: 'password12345' });
        expect(res.status).toBe(204);
      });

      it('suspended -> 204 No Content', async () => {
        const u = await createUser({
          username: 'del_suspended',
          email: 'del_suspended@matrix.local',
          password: 'password12345',
          displayName: 'Del Suspended',
          emailVerified: true,
        });
        const pool = getTestPool();
        await pool.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [u.id]);
        const cookie = await createSessionCookie(u.id);
        const res = await request
          .delete('/api/v1/users/me')
          .set('Cookie', cookie)
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp())
          .send({ password: 'password12345' });
        expect(res.status).toBe(204);
      });

      it('verified -> 204 No Content', async () => {
        const u = await createUser({
          username: 'del_verified',
          email: 'del_verified@matrix.local',
          password: 'password12345',
          displayName: 'Del Verified',
          emailVerified: true,
        });
        const cookie = await createSessionCookie(u.id);
        const res = await request
          .delete('/api/v1/users/me')
          .set('Cookie', cookie)
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp())
          .send({ password: 'password12345' });
        expect(res.status).toBe(204);
      });

      it('admin -> 204 No Content', async () => {
        const u = await createUser({
          username: 'del_admin',
          email: 'del_admin@matrix.local',
          password: 'password12345',
          displayName: 'Del Admin',
          role: 'admin',
          emailVerified: true,
        });
        const cookie = await createSessionCookie(u.id);
        const res = await request
          .delete('/api/v1/users/me')
          .set('Cookie', cookie)
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp())
          .send({ password: 'password12345' });
        expect(res.status).toBe(204);
      });
    });

    // -----------------------------------------------------------------------
    // 14. GET /api/v1/users/me/export
    // -----------------------------------------------------------------------
    describe('GET /api/v1/users/me/export', () => {
      it('unauthenticated -> 401 UNAUTHENTICATED', async () => {
        const res = await request
          .get('/api/v1/users/me/export')
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('UNAUTHENTICATED');
      });

      it('unverified -> 200 OK', async () => {
        const cookie = await createSessionCookie(unverifiedUserId);
        const res = await request
          .get('/api/v1/users/me/export')
          .set('Cookie', cookie)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(200);
        expect(res.body.profile).toBeDefined();
      });

      it('suspended -> 200 OK', async () => {
        const cookie = await createSessionCookie(suspendedUserId);
        const res = await request
          .get('/api/v1/users/me/export')
          .set('Cookie', cookie)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(200);
        expect(res.body.profile).toBeDefined();
      });

      it('verified -> 200 OK', async () => {
        const cookie = await createSessionCookie(verifiedUserId);
        const res = await request
          .get('/api/v1/users/me/export')
          .set('Cookie', cookie)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(200);
        expect(res.body.profile).toBeDefined();
      });

      it('admin -> 200 OK', async () => {
        const cookie = await createSessionCookie(adminUserId);
        const res = await request
          .get('/api/v1/users/me/export')
          .set('Cookie', cookie)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(200);
        expect(res.body.profile).toBeDefined();
      });
    });

    // -----------------------------------------------------------------------
    // 15. GET /api/v1/feed/following
    // -----------------------------------------------------------------------
    describe('GET /api/v1/feed/following', () => {
      it('unauthenticated -> 401 UNAUTHENTICATED', async () => {
        const res = await request
          .get('/api/v1/feed/following')
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('UNAUTHENTICATED');
      });

      it('unverified -> 200 OK', async () => {
        const cookie = await createSessionCookie(unverifiedUserId);
        const res = await request
          .get('/api/v1/feed/following')
          .set('Cookie', cookie)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.items)).toBe(true);
      });

      it('suspended -> 200 OK', async () => {
        const cookie = await createSessionCookie(suspendedUserId);
        const res = await request
          .get('/api/v1/feed/following')
          .set('Cookie', cookie)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.items)).toBe(true);
      });

      it('verified -> 200 OK', async () => {
        const cookie = await createSessionCookie(verifiedUserId);
        const res = await request
          .get('/api/v1/feed/following')
          .set('Cookie', cookie)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.items)).toBe(true);
      });

      it('admin -> 200 OK', async () => {
        const cookie = await createSessionCookie(adminUserId);
        const res = await request
          .get('/api/v1/feed/following')
          .set('Cookie', cookie)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.items)).toBe(true);
      });
    });

    // -----------------------------------------------------------------------
    // 16. GET /api/v1/me/score
    // -----------------------------------------------------------------------
    describe('GET /api/v1/me/score', () => {
      it('unauthenticated -> 401 UNAUTHENTICATED', async () => {
        const res = await request
          .get('/api/v1/me/score')
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('UNAUTHENTICATED');
      });

      it('unverified -> 200 OK', async () => {
        const cookie = await createSessionCookie(unverifiedUserId);
        const res = await request
          .get('/api/v1/me/score')
          .set('Cookie', cookie)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(200);
        expect(res.body.q).toBeDefined();
        expect(res.body.currentWave).toBeDefined();
      });

      it('suspended -> 200 OK', async () => {
        const cookie = await createSessionCookie(suspendedUserId);
        const res = await request
          .get('/api/v1/me/score')
          .set('Cookie', cookie)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(200);
        expect(res.body.q).toBeDefined();
      });

      it('verified -> 200 OK', async () => {
        const cookie = await createSessionCookie(verifiedUserId);
        const res = await request
          .get('/api/v1/me/score')
          .set('Cookie', cookie)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(200);
        expect(res.body.q).toBeDefined();
      });

      it('admin -> 200 OK', async () => {
        const cookie = await createSessionCookie(adminUserId);
        const res = await request
          .get('/api/v1/me/score')
          .set('Cookie', cookie)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(200);
        expect(res.body.q).toBeDefined();
      });
    });

    // -----------------------------------------------------------------------
    // 17. GET /api/v1/me/score/history
    // -----------------------------------------------------------------------
    describe('GET /api/v1/me/score/history', () => {
      it('unauthenticated -> 401 UNAUTHENTICATED', async () => {
        const res = await request
          .get('/api/v1/me/score/history')
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('UNAUTHENTICATED');
      });

      it('unverified -> 200 OK', async () => {
        const cookie = await createSessionCookie(unverifiedUserId);
        const res = await request
          .get('/api/v1/me/score/history')
          .set('Cookie', cookie)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.items)).toBe(true);
      });

      it('suspended -> 200 OK', async () => {
        const cookie = await createSessionCookie(suspendedUserId);
        const res = await request
          .get('/api/v1/me/score/history')
          .set('Cookie', cookie)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.items)).toBe(true);
      });

      it('verified -> 200 OK', async () => {
        const cookie = await createSessionCookie(verifiedUserId);
        const res = await request
          .get('/api/v1/me/score/history')
          .set('Cookie', cookie)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.items)).toBe(true);
      });

      it('admin -> 200 OK', async () => {
        const cookie = await createSessionCookie(adminUserId);
        const res = await request
          .get('/api/v1/me/score/history')
          .set('Cookie', cookie)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.items)).toBe(true);
      });
    });

    // -----------------------------------------------------------------------
    // 18. GET /api/v1/me/score/history/:waveNumber
    // -----------------------------------------------------------------------
    describe('GET /api/v1/me/score/history/:waveNumber', () => {
      beforeAll(async () => {
        const pool = getTestPool();
        // Insert a finalized wave (wave 888) with user_wave_reputation entry
        const waveRes = await pool.query<{ id: string }>(
          `INSERT INTO waves (number, status, opened_at, finalized_at)
           VALUES (888, 'finalized', now() - interval '10 days', now() - interval '3 days')
           ON CONFLICT (number) DO UPDATE SET status = 'finalized'
           RETURNING id`,
        );
        const wave888Id = waveRes.rows[0]!.id;

        // Bypassing ledger guard trigger via transaction with app.scoring='on'
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query("SET LOCAL app.scoring = 'on'");
          const insertRow = async (uid: string) => {
            await client.query(
              `INSERT INTO user_wave_reputation
               (user_id, wave_id, n_pos, n_neg, n_adj, r, sigma_used, q_before, delta, q_after, formula_version)
               VALUES ($1, $2, 1, 0, 0, 1, 0.500, 0.000, 0.500, 0.500, 'v1')
               ON CONFLICT DO NOTHING`,
              [uid, wave888Id],
            );
          };
          await insertRow(unverifiedUserId);
          await insertRow(suspendedUserId);
          await insertRow(verifiedUserId);
          await insertRow(adminUserId);
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }
      });

      it('unauthenticated -> 401 UNAUTHENTICATED', async () => {
        const res = await request
          .get('/api/v1/me/score/history/888')
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('UNAUTHENTICATED');
      });

      it('unverified -> 200 OK', async () => {
        const cookie = await createSessionCookie(unverifiedUserId);
        const res = await request
          .get('/api/v1/me/score/history/888')
          .set('Cookie', cookie)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(200);
        expect(res.body.row.waveNumber).toBe(888);
      });

      it('suspended -> 200 OK', async () => {
        const cookie = await createSessionCookie(suspendedUserId);
        const res = await request
          .get('/api/v1/me/score/history/888')
          .set('Cookie', cookie)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(200);
        expect(res.body.row.waveNumber).toBe(888);
      });

      it('verified -> 200 OK', async () => {
        const cookie = await createSessionCookie(verifiedUserId);
        const res = await request
          .get('/api/v1/me/score/history/888')
          .set('Cookie', cookie)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(200);
        expect(res.body.row.waveNumber).toBe(888);
      });

      it('admin -> 200 OK', async () => {
        const cookie = await createSessionCookie(adminUserId);
        const res = await request
          .get('/api/v1/me/score/history/888')
          .set('Cookie', cookie)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(200);
        expect(res.body.row.waveNumber).toBe(888);
      });
    });

    // -----------------------------------------------------------------------
    // 19. GET /api/v1/me/events
    // -----------------------------------------------------------------------
    describe('GET /api/v1/me/events', () => {
      it('unauthenticated -> 401 UNAUTHENTICATED', async () => {
        const res = await request
          .get('/api/v1/me/events')
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('UNAUTHENTICATED');
      });

      it('unverified -> 200 OK', async () => {
        const cookie = await createSessionCookie(unverifiedUserId);
        const res = await request
          .get('/api/v1/me/events')
          .set('Cookie', cookie)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.items)).toBe(true);
      });

      it('suspended -> 200 OK', async () => {
        const cookie = await createSessionCookie(suspendedUserId);
        const res = await request
          .get('/api/v1/me/events')
          .set('Cookie', cookie)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.items)).toBe(true);
      });

      it('verified -> 200 OK', async () => {
        const cookie = await createSessionCookie(verifiedUserId);
        const res = await request
          .get('/api/v1/me/events')
          .set('Cookie', cookie)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.items)).toBe(true);
      });

      it('admin -> 200 OK', async () => {
        const cookie = await createSessionCookie(adminUserId);
        const res = await request
          .get('/api/v1/me/events')
          .set('Cookie', cookie)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.items)).toBe(true);
      });
    });

    // -----------------------------------------------------------------------
    // 20. GET /api/v1/me/appeals
    // -----------------------------------------------------------------------
    describe('GET /api/v1/me/appeals', () => {
      it('unauthenticated -> 401 UNAUTHENTICATED', async () => {
        const res = await request
          .get('/api/v1/me/appeals')
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('UNAUTHENTICATED');
      });

      it('unverified -> 200 OK', async () => {
        const cookie = await createSessionCookie(unverifiedUserId);
        const res = await request
          .get('/api/v1/me/appeals')
          .set('Cookie', cookie)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.items)).toBe(true);
      });

      it('suspended -> 200 OK', async () => {
        const cookie = await createSessionCookie(suspendedUserId);
        const res = await request
          .get('/api/v1/me/appeals')
          .set('Cookie', cookie)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.items)).toBe(true);
      });

      it('verified -> 200 OK', async () => {
        const cookie = await createSessionCookie(verifiedUserId);
        const res = await request
          .get('/api/v1/me/appeals')
          .set('Cookie', cookie)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.items)).toBe(true);
      });

      it('admin -> 200 OK', async () => {
        const cookie = await createSessionCookie(adminUserId);
        const res = await request
          .get('/api/v1/me/appeals')
          .set('Cookie', cookie)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.items)).toBe(true);
      });
    });

    // -----------------------------------------------------------------------
    // 21. GET /api/v1/notifications
    // -----------------------------------------------------------------------
    describe('GET /api/v1/notifications', () => {
      it('unauthenticated -> 401 UNAUTHENTICATED', async () => {
        const res = await request
          .get('/api/v1/notifications')
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('UNAUTHENTICATED');
      });

      it('unverified -> 200 OK', async () => {
        const cookie = await createSessionCookie(unverifiedUserId);
        const res = await request
          .get('/api/v1/notifications')
          .set('Cookie', cookie)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.items)).toBe(true);
      });

      it('suspended -> 200 OK', async () => {
        const cookie = await createSessionCookie(suspendedUserId);
        const res = await request
          .get('/api/v1/notifications')
          .set('Cookie', cookie)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.items)).toBe(true);
      });

      it('verified -> 200 OK', async () => {
        const cookie = await createSessionCookie(verifiedUserId);
        const res = await request
          .get('/api/v1/notifications')
          .set('Cookie', cookie)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.items)).toBe(true);
      });

      it('admin -> 200 OK', async () => {
        const cookie = await createSessionCookie(adminUserId);
        const res = await request
          .get('/api/v1/notifications')
          .set('Cookie', cookie)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.items)).toBe(true);
      });
    });

    // -----------------------------------------------------------------------
    // 22. GET /api/v1/notifications/unread-count
    // -----------------------------------------------------------------------
    describe('GET /api/v1/notifications/unread-count', () => {
      it('unauthenticated -> 401 UNAUTHENTICATED', async () => {
        const res = await request
          .get('/api/v1/notifications/unread-count')
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('UNAUTHENTICATED');
      });

      it('unverified -> 200 OK', async () => {
        const cookie = await createSessionCookie(unverifiedUserId);
        const res = await request
          .get('/api/v1/notifications/unread-count')
          .set('Cookie', cookie)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(200);
        expect(typeof res.body.count).toBe('number');
      });

      it('suspended -> 200 OK', async () => {
        const cookie = await createSessionCookie(suspendedUserId);
        const res = await request
          .get('/api/v1/notifications/unread-count')
          .set('Cookie', cookie)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(200);
        expect(typeof res.body.count).toBe('number');
      });

      it('verified -> 200 OK', async () => {
        const cookie = await createSessionCookie(verifiedUserId);
        const res = await request
          .get('/api/v1/notifications/unread-count')
          .set('Cookie', cookie)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(200);
        expect(typeof res.body.count).toBe('number');
      });

      it('admin -> 200 OK', async () => {
        const cookie = await createSessionCookie(adminUserId);
        const res = await request
          .get('/api/v1/notifications/unread-count')
          .set('Cookie', cookie)
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(200);
        expect(typeof res.body.count).toBe('number');
      });
    });

    // -----------------------------------------------------------------------
    // 23. POST /api/v1/notifications/read
    // -----------------------------------------------------------------------
    describe('POST /api/v1/notifications/read', () => {
      it('unauthenticated -> 401 UNAUTHENTICATED', async () => {
        const res = await request
          .post('/api/v1/notifications/read')
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp())
          .send({});
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('UNAUTHENTICATED');
      });

      it('unverified -> 204 No Content', async () => {
        const cookie = await createSessionCookie(unverifiedUserId);
        const res = await request
          .post('/api/v1/notifications/read')
          .set('Cookie', cookie)
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp())
          .send({});
        expect(res.status).toBe(204);
      });

      it('suspended -> 204 No Content', async () => {
        const cookie = await createSessionCookie(suspendedUserId);
        const res = await request
          .post('/api/v1/notifications/read')
          .set('Cookie', cookie)
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp())
          .send({});
        expect(res.status).toBe(204);
      });

      it('verified -> 204 No Content', async () => {
        const cookie = await createSessionCookie(verifiedUserId);
        const res = await request
          .post('/api/v1/notifications/read')
          .set('Cookie', cookie)
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp())
          .send({});
        expect(res.status).toBe(204);
      });

      it('admin -> 204 No Content', async () => {
        const cookie = await createSessionCookie(adminUserId);
        const res = await request
          .post('/api/v1/notifications/read')
          .set('Cookie', cookie)
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp())
          .send({});
        expect(res.status).toBe(204);
      });
    });

    // -----------------------------------------------------------------------
    // 24. GET /api/v1/notifications/stream
    // -----------------------------------------------------------------------
    describe('GET /api/v1/notifications/stream', () => {
      let server: http.Server;
      let port: number;

      beforeAll(async () => {
        server = http.createServer(app);
        await new Promise<void>((resolve) => server.listen(0, resolve));
        const addr = server.address();
        port = typeof addr === 'object' && addr ? addr.port : 0;
      });

      afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      });

      it('unauthenticated -> 401 UNAUTHENTICATED', async () => {
        const res = await request
          .get('/api/v1/notifications/stream')
          .set('X-Forwarded-For', nextIp());
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('UNAUTHENTICATED');
      });

      async function testSseAllowed(cookie: string): Promise<void> {
        return new Promise<void>((resolve, reject) => {
          const clientReq = http.request(
            {
              port,
              path: '/api/v1/notifications/stream',
              method: 'GET',
              headers: {
                Cookie: cookie,
                'X-Forwarded-For': nextIp(),
              },
            },
            (res) => {
              try {
                expect(res.statusCode).toBe(200);
                expect(res.headers['content-type']).toBe('text/event-stream');
                clientReq.destroy();
                resolve();
              } catch (err) {
                clientReq.destroy();
                reject(err);
              }
            },
          );
          clientReq.on('error', (err) => {
            if ((err as { code?: string }).code !== 'ECONNRESET') {
              reject(err);
            } else {
              resolve();
            }
          });
          clientReq.end();
        });
      }

      it('unverified -> 200 text/event-stream', async () => {
        const cookie = await createSessionCookie(unverifiedUserId);
        await testSseAllowed(cookie);
      });

      it('suspended -> 200 text/event-stream', async () => {
        const cookie = await createSessionCookie(suspendedUserId);
        await testSseAllowed(cookie);
      });

      it('verified -> 200 text/event-stream', async () => {
        const cookie = await createSessionCookie(verifiedUserId);
        await testSseAllowed(cookie);
      });

      it('admin -> 200 text/event-stream', async () => {
        const cookie = await createSessionCookie(adminUserId);
        await testSseAllowed(cookie);
      });
    });
  });

  // =========================================================================
  // SECTION 3: Pub Endpoints (Public)
  //   Unauthenticated -> Allowed (not 401/403)
  //   Unverified      -> Allowed (not 401/403)
  //   Suspended       -> Allowed (not 401/403)
  //   Verified        -> Allowed (not 401/403)
  //   Admin           -> Allowed (not 401/403)
  // =========================================================================
  describe('Pub Endpoints (Public)', () => {
    // -----------------------------------------------------------------------
    // 25. POST /api/v1/auth/register
    // -----------------------------------------------------------------------
    describe('POST /api/v1/auth/register', () => {
      let regIdx = 1;
      async function testRegister(cookie?: string): Promise<void> {
        const reqBuilder = request
          .post('/api/v1/auth/register')
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp());
        if (cookie) reqBuilder.set('Cookie', cookie);

        const res = await reqBuilder.send({
          username: `matrix_reg_${regIdx}`,
          email: `matrix_reg_${regIdx}@matrix.local`,
          password: 'password12345',
          displayName: `Matrix Reg ${regIdx}`,
        });
        regIdx += 1;
        expect(res.status).toBe(201);
        expect(res.body.user).toBeDefined();
      }

      it('unauthenticated -> 201 CREATED', async () => {
        await testRegister();
      });

      it('unverified -> 201 CREATED', async () => {
        const cookie = await createSessionCookie(unverifiedUserId);
        await testRegister(cookie);
      });

      it('suspended -> 201 CREATED', async () => {
        const cookie = await createSessionCookie(suspendedUserId);
        await testRegister(cookie);
      });

      it('verified -> 201 CREATED', async () => {
        const cookie = await createSessionCookie(verifiedUserId);
        await testRegister(cookie);
      });

      it('admin -> 201 CREATED', async () => {
        const cookie = await createSessionCookie(adminUserId);
        await testRegister(cookie);
      });
    });

    // -----------------------------------------------------------------------
    // 26. POST /api/v1/auth/login
    // -----------------------------------------------------------------------
    describe('POST /api/v1/auth/login', () => {
      async function testLogin(cookie?: string): Promise<void> {
        const reqBuilder = request
          .post('/api/v1/auth/login')
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp());
        if (cookie) reqBuilder.set('Cookie', cookie);

        const res = await reqBuilder.send({
          identifier: 'pub_author',
          password: 'password12345',
        });
        expect(res.status).toBe(200);
        expect(res.body.user.username).toBe('pub_author');
      }

      it('unauthenticated -> 200 OK', async () => {
        await testLogin();
      });

      it('unverified -> 200 OK', async () => {
        const cookie = await createSessionCookie(unverifiedUserId);
        await testLogin(cookie);
      });

      it('suspended -> 200 OK', async () => {
        const cookie = await createSessionCookie(suspendedUserId);
        await testLogin(cookie);
      });

      it('verified -> 200 OK', async () => {
        const cookie = await createSessionCookie(verifiedUserId);
        await testLogin(cookie);
      });

      it('admin -> 200 OK', async () => {
        const cookie = await createSessionCookie(adminUserId);
        await testLogin(cookie);
      });
    });

    // -----------------------------------------------------------------------
    // 27. POST /api/v1/auth/verify-email
    // -----------------------------------------------------------------------
    describe('POST /api/v1/auth/verify-email', () => {
      async function testVerifyEmail(cookie?: string): Promise<void> {
        const reqBuilder = request
          .post('/api/v1/auth/verify-email')
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp());
        if (cookie) reqBuilder.set('Cookie', cookie);

        const res = await reqBuilder.send({
          token: crypto.randomBytes(32).toString('base64url'),
        });
        // Non-existent token -> 400 VALIDATION_ERROR, neither 401 nor 403
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      }

      it('unauthenticated -> 400 VALIDATION_ERROR', async () => {
        await testVerifyEmail();
      });

      it('unverified -> 400 VALIDATION_ERROR', async () => {
        const cookie = await createSessionCookie(unverifiedUserId);
        await testVerifyEmail(cookie);
      });

      it('suspended -> 400 VALIDATION_ERROR', async () => {
        const cookie = await createSessionCookie(suspendedUserId);
        await testVerifyEmail(cookie);
      });

      it('verified -> 400 VALIDATION_ERROR', async () => {
        const cookie = await createSessionCookie(verifiedUserId);
        await testVerifyEmail(cookie);
      });

      it('admin -> 400 VALIDATION_ERROR', async () => {
        const cookie = await createSessionCookie(adminUserId);
        await testVerifyEmail(cookie);
      });
    });

    // -----------------------------------------------------------------------
    // 28. POST /api/v1/auth/forgot-password
    // -----------------------------------------------------------------------
    describe('POST /api/v1/auth/forgot-password', () => {
      async function testForgotPassword(cookie?: string): Promise<void> {
        const reqBuilder = request
          .post('/api/v1/auth/forgot-password')
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp());
        if (cookie) reqBuilder.set('Cookie', cookie);

        const res = await reqBuilder.send({
          email: 'pub_author@matrix.local',
        });
        // SEC-009: always returns 204
        expect(res.status).toBe(204);
      }

      it('unauthenticated -> 204 No Content', async () => {
        await testForgotPassword();
      });

      it('unverified -> 204 No Content', async () => {
        const cookie = await createSessionCookie(unverifiedUserId);
        await testForgotPassword(cookie);
      });

      it('suspended -> 204 No Content', async () => {
        const cookie = await createSessionCookie(suspendedUserId);
        await testForgotPassword(cookie);
      });

      it('verified -> 204 No Content', async () => {
        const cookie = await createSessionCookie(verifiedUserId);
        await testForgotPassword(cookie);
      });

      it('admin -> 204 No Content', async () => {
        const cookie = await createSessionCookie(adminUserId);
        await testForgotPassword(cookie);
      });
    });

    // -----------------------------------------------------------------------
    // 29. POST /api/v1/auth/reset-password
    // -----------------------------------------------------------------------
    describe('POST /api/v1/auth/reset-password', () => {
      async function testResetPassword(cookie?: string): Promise<void> {
        const reqBuilder = request
          .post('/api/v1/auth/reset-password')
          .set('Origin', config.APP_ORIGIN)
          .set('X-Forwarded-For', nextIp());
        if (cookie) reqBuilder.set('Cookie', cookie);

        const res = await reqBuilder.send({
          token: crypto.randomBytes(32).toString('base64url'),
          password: 'newvalidpassword123',
        });
        // Unknown token returns 400 VALIDATION_ERROR, neither 401 nor 403
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      }

      it('unauthenticated -> 400 VALIDATION_ERROR', async () => {
        await testResetPassword();
      });

      it('unverified -> 400 VALIDATION_ERROR', async () => {
        const cookie = await createSessionCookie(unverifiedUserId);
        await testResetPassword(cookie);
      });

      it('suspended -> 400 VALIDATION_ERROR', async () => {
        const cookie = await createSessionCookie(suspendedUserId);
        await testResetPassword(cookie);
      });

      it('verified -> 400 VALIDATION_ERROR', async () => {
        const cookie = await createSessionCookie(verifiedUserId);
        await testResetPassword(cookie);
      });

      it('admin -> 400 VALIDATION_ERROR', async () => {
        const cookie = await createSessionCookie(adminUserId);
        await testResetPassword(cookie);
      });
    });

    // -----------------------------------------------------------------------
    // 30. GET /api/v1/users/:username
    // -----------------------------------------------------------------------
    describe('GET /api/v1/users/:username', () => {
      async function testGetUser(cookie?: string): Promise<void> {
        const reqBuilder = request
          .get(`/api/v1/users/${publicUsername}`)
          .set('X-Forwarded-For', nextIp());
        if (cookie) reqBuilder.set('Cookie', cookie);

        const res = await reqBuilder;
        expect(res.status).toBe(200);
        expect(res.body.username).toBe(publicUsername);
      }

      it('unauthenticated -> 200 OK', async () => {
        await testGetUser();
      });

      it('unverified -> 200 OK', async () => {
        const cookie = await createSessionCookie(unverifiedUserId);
        await testGetUser(cookie);
      });

      it('suspended -> 200 OK', async () => {
        const cookie = await createSessionCookie(suspendedUserId);
        await testGetUser(cookie);
      });

      it('verified -> 200 OK', async () => {
        const cookie = await createSessionCookie(verifiedUserId);
        await testGetUser(cookie);
      });

      it('admin -> 200 OK', async () => {
        const cookie = await createSessionCookie(adminUserId);
        await testGetUser(cookie);
      });
    });

    // -----------------------------------------------------------------------
    // 31. GET /api/v1/users/:username/posts
    // -----------------------------------------------------------------------
    describe('GET /api/v1/users/:username/posts', () => {
      async function testGetUserPosts(cookie?: string): Promise<void> {
        const reqBuilder = request
          .get(`/api/v1/users/${publicUsername}/posts`)
          .set('X-Forwarded-For', nextIp());
        if (cookie) reqBuilder.set('Cookie', cookie);

        const res = await reqBuilder;
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.items)).toBe(true);
      }

      it('unauthenticated -> 200 OK', async () => {
        await testGetUserPosts();
      });

      it('unverified -> 200 OK', async () => {
        const cookie = await createSessionCookie(unverifiedUserId);
        await testGetUserPosts(cookie);
      });

      it('suspended -> 200 OK', async () => {
        const cookie = await createSessionCookie(suspendedUserId);
        await testGetUserPosts(cookie);
      });

      it('verified -> 200 OK', async () => {
        const cookie = await createSessionCookie(verifiedUserId);
        await testGetUserPosts(cookie);
      });

      it('admin -> 200 OK', async () => {
        const cookie = await createSessionCookie(adminUserId);
        await testGetUserPosts(cookie);
      });
    });

    // -----------------------------------------------------------------------
    // 32. GET /api/v1/posts/:id
    // -----------------------------------------------------------------------
    describe('GET /api/v1/posts/:id', () => {
      async function testGetPost(cookie?: string): Promise<void> {
        const reqBuilder = request
          .get(`/api/v1/posts/${publicPostId}`)
          .set('X-Forwarded-For', nextIp());
        if (cookie) reqBuilder.set('Cookie', cookie);

        const res = await reqBuilder;
        expect(res.status).toBe(200);
        expect(res.body.id).toBe(publicPostId);
      }

      it('unauthenticated -> 200 OK', async () => {
        await testGetPost();
      });

      it('unverified -> 200 OK', async () => {
        const cookie = await createSessionCookie(unverifiedUserId);
        await testGetPost(cookie);
      });

      it('suspended -> 200 OK', async () => {
        const cookie = await createSessionCookie(suspendedUserId);
        await testGetPost(cookie);
      });

      it('verified -> 200 OK', async () => {
        const cookie = await createSessionCookie(verifiedUserId);
        await testGetPost(cookie);
      });

      it('admin -> 200 OK', async () => {
        const cookie = await createSessionCookie(adminUserId);
        await testGetPost(cookie);
      });
    });

    // -----------------------------------------------------------------------
    // 33. GET /api/v1/feed/global
    // -----------------------------------------------------------------------
    describe('GET /api/v1/feed/global', () => {
      async function testGetGlobalFeed(cookie?: string): Promise<void> {
        const reqBuilder = request
          .get('/api/v1/feed/global')
          .set('X-Forwarded-For', nextIp());
        if (cookie) reqBuilder.set('Cookie', cookie);

        const res = await reqBuilder;
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.items)).toBe(true);
      }

      it('unauthenticated -> 200 OK', async () => {
        await testGetGlobalFeed();
      });

      it('unverified -> 200 OK', async () => {
        const cookie = await createSessionCookie(unverifiedUserId);
        await testGetGlobalFeed(cookie);
      });

      it('suspended -> 200 OK', async () => {
        const cookie = await createSessionCookie(suspendedUserId);
        await testGetGlobalFeed(cookie);
      });

      it('verified -> 200 OK', async () => {
        const cookie = await createSessionCookie(verifiedUserId);
        await testGetGlobalFeed(cookie);
      });

      it('admin -> 200 OK', async () => {
        const cookie = await createSessionCookie(adminUserId);
        await testGetGlobalFeed(cookie);
      });
    });

    // -----------------------------------------------------------------------
    // 34. GET /api/v1/users/:username/score
    // -----------------------------------------------------------------------
    describe('GET /api/v1/users/:username/score', () => {
      async function testGetUserScore(cookie?: string): Promise<void> {
        const reqBuilder = request
          .get(`/api/v1/users/${publicUsername}/score`)
          .set('X-Forwarded-For', nextIp());
        if (cookie) reqBuilder.set('Cookie', cookie);

        const res = await reqBuilder;
        expect(res.status).toBe(200);
        expect(res.body.tier).toBeDefined();
      }

      it('unauthenticated -> 200 OK', async () => {
        await testGetUserScore();
      });

      it('unverified -> 200 OK', async () => {
        const cookie = await createSessionCookie(unverifiedUserId);
        await testGetUserScore(cookie);
      });

      it('suspended -> 200 OK', async () => {
        const cookie = await createSessionCookie(suspendedUserId);
        await testGetUserScore(cookie);
      });

      it('verified -> 200 OK', async () => {
        const cookie = await createSessionCookie(verifiedUserId);
        await testGetUserScore(cookie);
      });

      it('admin -> 200 OK', async () => {
        const cookie = await createSessionCookie(adminUserId);
        await testGetUserScore(cookie);
      });
    });

    // -----------------------------------------------------------------------
    // 35. GET /api/v1/waves/current
    // -----------------------------------------------------------------------
    describe('GET /api/v1/waves/current', () => {
      async function testGetCurrentWave(cookie?: string): Promise<void> {
        const reqBuilder = request
          .get('/api/v1/waves/current')
          .set('X-Forwarded-For', nextIp());
        if (cookie) reqBuilder.set('Cookie', cookie);

        const res = await reqBuilder;
        expect(res.status).toBe(200);
        expect(res.body.number).toBeDefined();
      }

      it('unauthenticated -> 200 OK', async () => {
        await testGetCurrentWave();
      });

      it('unverified -> 200 OK', async () => {
        const cookie = await createSessionCookie(unverifiedUserId);
        await testGetCurrentWave(cookie);
      });

      it('suspended -> 200 OK', async () => {
        const cookie = await createSessionCookie(suspendedUserId);
        await testGetCurrentWave(cookie);
      });

      it('verified -> 200 OK', async () => {
        const cookie = await createSessionCookie(verifiedUserId);
        await testGetCurrentWave(cookie);
      });

      it('admin -> 200 OK', async () => {
        const cookie = await createSessionCookie(adminUserId);
        await testGetCurrentWave(cookie);
      });
    });
  });
});
