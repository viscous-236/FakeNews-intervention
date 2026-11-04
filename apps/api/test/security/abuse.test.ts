/**
 * apps/api/test/security/abuse.test.ts (TASK-107, TEST-107)
 *
 * Abuse and vulnerability tests:
 *   - Insecure Direct Object References (IDOR)
 *   - Mass Assignment Prevention
 *   - SQL Injection strings
 *   - Stored XSS as text
 *   - Server-Side Request Forgery (SSRF) defense
 */

import { describe, it, expect, beforeEach } from 'vitest';
import supertest from 'supertest';
import crypto from 'crypto';
import { createApp } from '../../src/app.js';
import { config } from '../../src/config.js';
import { getTestPool, truncateAll } from '../setup/db.js';
import { createTestUser } from '../setup/factories.js';

describe('TEST-107: Abuse, IDOR, Injection, and Mass Assignment', () => {
  const app = createApp();
  const request = supertest(app);

  let userAId: string;
  let userBId: string;
  let userACookie: string;
  let userBCookie: string;

  async function createSessionCookie(userId: string): Promise<string> {
    const rawToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const pool = getTestPool();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await pool.query(`INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`, [
      userId,
      tokenHash,
      expiresAt,
    ]);
    return `${config.SESSION_COOKIE_NAME}=${rawToken}`;
  }

  beforeEach(async () => {
    await truncateAll();

    // Create User A
    const userA = await createTestUser({
      username: 'alice_user',
      email: 'alice@test.local',
      displayName: 'Alice User',
    });
    userAId = userA.id;
    userACookie = await createSessionCookie(userAId);

    // Create User B
    const userB = await createTestUser({
      username: 'bob_user',
      email: 'bob@test.local',
      displayName: 'Bob User',
    });
    userBId = userB.id;
    userBCookie = await createSessionCookie(userBId);

    // Create Admin
    await createTestUser({
      username: 'admin_user',
      email: 'admin@test.local',
      displayName: 'Admin Master',
      role: 'admin',
    });
  });

  describe('1. Insecure Direct Object References (IDOR)', () => {
    it('prevents user A from editing user B post', async () => {
      // User B creates a post
      const createRes = await request
        .post('/api/v1/posts')
        .set('Origin', config.APP_ORIGIN)
        .set('Cookie', userBCookie)
        .send({
          body: 'This is a genuine post created by Bob for IDOR test.',
        });
      expect(createRes.status).toBe(201);
      const postId = createRes.body.id;

      // User A attempts to edit Bob's post
      const editRes = await request
        .patch(`/api/v1/posts/${postId}`)
        .set('Origin', config.APP_ORIGIN)
        .set('Cookie', userACookie)
        .send({
          body: 'Malicious modification attempted by Alice on Bob post.',
        });

      // Must be rejected (cannot edit another user's post)
      expect([403, 404, 409]).toContain(editRes.status);
      if (editRes.status === 409) {
        expect(editRes.body.error.code).toBe('EDIT_NOT_ALLOWED');
      }
    });

    it('prevents user A from deleting user B post', async () => {
      // User B creates a post
      const createRes = await request
        .post('/api/v1/posts')
        .set('Origin', config.APP_ORIGIN)
        .set('Cookie', userBCookie)
        .send({
          body: 'This is another post created by Bob to test deletion IDOR.',
        });
      expect(createRes.status).toBe(201);
      const postId = createRes.body.id;

      // User A attempts to delete Bob's post
      const deleteRes = await request
        .delete(`/api/v1/posts/${postId}`)
        .set('Origin', config.APP_ORIGIN)
        .set('Cookie', userACookie);

      expect([403, 404]).toContain(deleteRes.status);
    });

    it('prevents regular user from accessing administrator queue and audit endpoints', async () => {
      const queueRes = await request.get('/api/v1/admin/queue').set('Cookie', userACookie);
      expect(queueRes.status).toBe(403);
      expect(queueRes.body.error.code).toBe('FORBIDDEN');

      const auditRes = await request.get('/api/v1/admin/audit').set('Cookie', userACookie);
      expect(auditRes.status).toBe(403);
      expect(auditRes.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('2. Mass Assignment Prevention', () => {
    it('rejects attempts to inject role or elevated fields during registration', async () => {
      const res = await request
        .post('/api/v1/auth/register')
        .set('Origin', config.APP_ORIGIN)
        .send({
          username: 'eve_attacker',
          email: 'eve@attack.local',
          password: 'EvePassword123!',
          displayName: 'Eve Attacker',
          role: 'admin',
          q: '10.0',
          sigma: '0.1',
          status: 'active',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects attempts to modify immutable fields on user profile update', async () => {
      const res = await request
        .patch('/api/v1/users/me')
        .set('Origin', config.APP_ORIGIN)
        .set('Cookie', userACookie)
        .send({
          displayName: 'Alice Updated',
          role: 'admin',
          q: '9.99',
          sigma: '0.99',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('3. SQL Injection Defense', () => {
    it('safely handles SQL injection payloads in login identifier', async () => {
      const injectionPayloads = [
        "' OR '1'='1",
        "admin'--",
        "' OR 1=1; --",
        "'; DROP TABLE users; --",
        "' UNION SELECT * FROM users --",
      ];

      for (const payload of injectionPayloads) {
        const res = await request.post('/api/v1/auth/login').set('Origin', config.APP_ORIGIN).send({
          identifier: payload,
          password: 'SomePassword123!',
        });

        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
      }

      // Verify that database table was not dropped or compromised
      const pool = getTestPool();
      const usersCheck = await pool.query('SELECT count(*) FROM users');
      expect(Number(usersCheck.rows[0].count)).toBeGreaterThanOrEqual(3);
    });

    it('safely handles SQL injection payloads in search queries', async () => {
      const injectionQueries = [
        "'; DROP TABLE posts; --",
        "%' OR '1'='1",
        "\\'; SELECT pg_sleep(1); --",
      ];

      for (const q of injectionQueries) {
        const res = await request
          .get('/api/v1/search/posts')
          .query({ q })
          .set('Cookie', userACookie);

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.items)).toBe(true);
      }
    });
  });

  describe('4. Stored XSS Defense', () => {
    it('stores HTML/XSS payloads as plain text and returns them without execution', async () => {
      const xssPayload = "<script>alert('XSS-ATTACK')</script><img src=x onerror=alert(1)>";

      const createRes = await request
        .post('/api/v1/posts')
        .set('Origin', config.APP_ORIGIN)
        .set('Cookie', userACookie)
        .send({
          body: `Genuine post containing special characters: ${xssPayload}`,
        });

      expect(createRes.status).toBe(201);
      const post = createRes.body;

      // Returned as pure text string
      expect(post.body).toContain(xssPayload);

      // Fetch back from GET /posts/:id
      const getRes = await request.get(`/api/v1/posts/${post.id}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.body).toBe(post.body);

      // Verify CSP header prevents script injection
      const csp = getRes.headers['content-security-policy'];
      expect(csp).toContain("script-src 'self'");
      expect(csp).toContain("object-src 'none'");
    });
  });

  describe('5. SSRF Defense', () => {
    it('rejects invalid or dangerous protocol schemes in sourceUrl', async () => {
      const dangerousUrls = [
        'file:///etc/passwd',
        'gopher://127.0.0.1:5433',
        'javascript:alert(1)',
      ];

      for (const badUrl of dangerousUrls) {
        const res = await request
          .post('/api/v1/posts')
          .set('Origin', config.APP_ORIGIN)
          .set('Cookie', userACookie)
          .send({
            body: 'Valid post body that contains a malformed source URL.',
            sourceUrl: badUrl,
          });

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      }
    });
  });
});
