/**
 * apps/api/test/modules/auth/auth.test.ts (TASK-038)
 *
 * Tests TEST-040 through TEST-045:
 *   - TEST-040: Register creates user with sigma=SIGMA_DEFAULT, q=0.000, unverified email, queued verification mail
 *   - TEST-041: Duplicate username or email (case-insensitive) returns 409 USERNAME_TAKEN or EMAIL_TAKEN
 *   - TEST-042: Login success sets cookie with HttpOnly, SameSite=Lax, Secure; wrong password and unknown user both return 401
 *   - TEST-043: Five failed logins in 15 minutes lock further attempts with 429
 *   - TEST-044: Logout deletes the session; old cookie returns 401
 *   - TEST-045: Expired session returns 401 and is deleted
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import supertest from 'supertest';
import { createApp } from '../../../src/app.js';
import { getTestPool, closeTestPool, truncateAll } from '../../setup/db.js';
import { config } from '../../../src/config.js';

describe('Auth Module (TEST-040 through TEST-045)', () => {
  const app = createApp();
  const request = supertest(app);

  beforeAll(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await closeTestPool();
  });

  it('TEST-040: Register creates user with sigma = SIGMA_DEFAULT, q = 0.000, unverified email and queued verification mail', async () => {
    const res = await request
      .post('/api/v1/auth/register')
      .set('Origin', config.APP_ORIGIN)
      .send({
        username: 'alice_040',
        email: 'alice040@example.com',
        password: 'password12345',
        displayName: 'Alice 040',
      });

    expect(res.status).toBe(201);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.username).toBe('alice_040');
    expect(res.body.user.email).toBe('alice040@example.com');
    expect(res.body.user.emailVerified).toBe(false);
    expect(res.body.user.score.q).toBe('0.000');
    expect(res.body.user.score.sigma).toBe(config.SIGMA_DEFAULT.toFixed(3));
    expect(res.body.user.score.tier).toBe('neutral');

    // Cookie set
    const setCookie = res.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    const cookieStr = (Array.isArray(setCookie) ? setCookie.join('; ') : setCookie) || '';
    expect(cookieStr).toContain(config.SESSION_COOKIE_NAME);
    expect(cookieStr.toLowerCase()).toContain('httponly');
    expect(cookieStr.toLowerCase()).toContain('samesite=lax');

    // DB inspection: email token and email outbox queued
    const pool = getTestPool();
    const tokens = await pool.query<{ purpose: string }>(
      `SELECT purpose FROM email_tokens WHERE user_id = $1`,
      [res.body.user.id],
    );
    expect(tokens.rows).toHaveLength(1);
    expect(tokens.rows[0]!.purpose).toBe('verify_email');

    const outbox = await pool.query<{ to_email: string; status: string }>(
      `SELECT to_email, status FROM email_outbox WHERE to_email = $1`,
      ['alice040@example.com'],
    );
    expect(outbox.rows).toHaveLength(1);
    expect(outbox.rows[0]!.status).toBe('queued');
  });

  it('TEST-041: Duplicate username or email (case-insensitive) returns 409 USERNAME_TAKEN or EMAIL_TAKEN', async () => {
    // Attempt duplicate username
    const resUsername = await request
      .post('/api/v1/auth/register')
      .set('Origin', config.APP_ORIGIN)
      .set('X-Forwarded-For', '10.0.1.1')
      .send({
        username: 'alice_040',
        email: 'different@example.com',
        password: 'password12345',
        displayName: 'Different Alice',
      });

    expect(resUsername.status).toBe(409);
    expect(resUsername.body.error.code).toBe('USERNAME_TAKEN');

    // Attempt duplicate email (different case)
    const resEmail = await request
      .post('/api/v1/auth/register')
      .set('Origin', config.APP_ORIGIN)
      .set('X-Forwarded-For', '10.0.1.2')
      .send({
        username: 'alice_unique',
        email: 'ALICE040@EXAMPLE.COM', // uppercase variant
        password: 'password12345',
        displayName: 'Different User',
      });

    expect(resEmail.status).toBe(409);
    expect(resEmail.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('TEST-042: Login success sets session cookie; wrong password and unknown user both return 401 INVALID_CREDENTIALS', async () => {
    const ip = '10.0.2.1';

    // 1. Unknown user login
    const resUnknown = await request
      .post('/api/v1/auth/login')
      .set('Origin', config.APP_ORIGIN)
      .set('X-Forwarded-For', ip)
      .send({
        identifier: 'nonexistent_user',
        password: 'password12345',
      });
    expect(resUnknown.status).toBe(401);
    expect(resUnknown.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(resUnknown.body.error.message).toBe('Invalid credentials');

    // 2. Wrong password for existing user
    const resWrongPw = await request
      .post('/api/v1/auth/login')
      .set('Origin', config.APP_ORIGIN)
      .set('X-Forwarded-For', ip)
      .send({
        identifier: 'alice_040',
        password: 'wrong_password_xyz',
      });
    expect(resWrongPw.status).toBe(401);
    expect(resWrongPw.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(resWrongPw.body.error.message).toBe('Invalid credentials');

    // 3. Successful login using username
    const resSuccess = await request
      .post('/api/v1/auth/login')
      .set('Origin', config.APP_ORIGIN)
      .set('X-Forwarded-For', ip)
      .send({
        identifier: 'alice_040',
        password: 'password12345',
      });
    expect(resSuccess.status).toBe(200);
    expect(resSuccess.body.user.username).toBe('alice_040');

    const setCookie = resSuccess.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    const cookieStr = (Array.isArray(setCookie) ? setCookie.join('; ') : setCookie) || '';
    expect(cookieStr).toContain(config.SESSION_COOKIE_NAME);
    expect(cookieStr.toLowerCase()).toContain('httponly');
    expect(cookieStr.toLowerCase()).toContain('samesite=lax');

    // 4. Successful login using email (case-insensitive)
    const resEmailSuccess = await request
      .post('/api/v1/auth/login')
      .set('Origin', config.APP_ORIGIN)
      .set('X-Forwarded-For', ip)
      .send({
        identifier: 'ALICE040@EXAMPLE.COM',
        password: 'password12345',
      });
    expect(resEmailSuccess.status).toBe(200);
    expect(resEmailSuccess.body.user.username).toBe('alice_040');
  });

  it('TEST-043: Five failed logins in 15 minutes lock further attempts with 429 RATE_LIMITED', async () => {
    const identifier = 'lockout_target_user';
    const ip = '10.0.3.1';

    // Register user first
    await request
      .post('/api/v1/auth/register')
      .set('Origin', config.APP_ORIGIN)
      .set('X-Forwarded-For', ip)
      .send({
        username: identifier,
        email: 'lockout@example.com',
        password: 'correct_password_123',
        displayName: 'Lockout Target',
      });

    // Send 4 failed attempts
    for (let i = 1; i <= 4; i++) {
      const res = await request
        .post('/api/v1/auth/login')
        .set('Origin', config.APP_ORIGIN)
        .set('X-Forwarded-For', ip)
        .send({
          identifier,
          password: 'bad_password',
        });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    }

    // 5th failed attempt
    const res5 = await request
      .post('/api/v1/auth/login')
      .set('Origin', config.APP_ORIGIN)
      .set('X-Forwarded-For', ip)
      .send({
        identifier,
        password: 'bad_password',
      });
    expect(res5.status).toBe(401);

    // 6th attempt is locked out (429 RATE_LIMITED), even with correct password!
    const resLocked = await request
      .post('/api/v1/auth/login')
      .set('Origin', config.APP_ORIGIN)
      .set('X-Forwarded-For', ip)
      .send({
        identifier,
        password: 'correct_password_123',
      });
    expect(resLocked.status).toBe(429);
    expect(resLocked.body.error.code).toBe('RATE_LIMITED');
    expect(resLocked.body.error.message).toMatch(/Too many failed login attempts/i);
  });

  it('TEST-044: Logout deletes the session; old cookie returns 401', async () => {
    const ip = '10.0.4.1';

    // 1. Login to obtain session cookie
    const loginRes = await request
      .post('/api/v1/auth/login')
      .set('Origin', config.APP_ORIGIN)
      .set('X-Forwarded-For', ip)
      .send({
        identifier: 'alice_040',
        password: 'password12345',
      });
    expect(loginRes.status).toBe(200);

    const cookieHeader = loginRes.headers['set-cookie'];
    const cookie = Array.isArray(cookieHeader) ? cookieHeader[0]! : cookieHeader!;

    // 2. Call GET /auth/me with cookie -> 200
    const meBefore = await request.get('/api/v1/auth/me').set('Cookie', cookie);
    expect(meBefore.status).toBe(200);
    expect(meBefore.body.user.username).toBe('alice_040');

    // 3. Call POST /auth/logout
    const logoutRes = await request
      .post('/api/v1/auth/logout')
      .set('Origin', config.APP_ORIGIN)
      .set('X-Forwarded-For', ip)
      .set('Cookie', cookie);
    expect(logoutRes.status).toBe(204);

    // 4. Call GET /auth/me with old cookie -> 401 UNAUTHENTICATED
    const meAfter = await request.get('/api/v1/auth/me').set('Cookie', cookie);
    expect(meAfter.status).toBe(401);
    expect(meAfter.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('TEST-045: An expired session returns 401 and is deleted', async () => {
    const ip = '10.0.5.1';

    // 1. Login
    const loginRes = await request
      .post('/api/v1/auth/login')
      .set('Origin', config.APP_ORIGIN)
      .set('X-Forwarded-For', ip)
      .send({
        identifier: 'alice_040',
        password: 'password12345',
      });
    expect(loginRes.status).toBe(200);
    const cookieHeader = loginRes.headers['set-cookie'];
    const cookie = Array.isArray(cookieHeader) ? cookieHeader[0]! : cookieHeader!;

    // 2. Manually expire the current session in the database
    const pool = getTestPool();
    const rawToken = cookie.split(';')[0]!.split('=')[1]!;
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    await pool.query(
      `UPDATE sessions SET expires_at = now() - interval '1 hour'
       WHERE token_hash = $1`,
      [tokenHash],
    );

    // 3. Request with expired session cookie -> 401 UNAUTHENTICATED
    const res = await request.get('/api/v1/auth/me').set('Cookie', cookie);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');

    // 4. Verify that expired session was deleted
    const sessionCount = await pool.query<{ count: string }>(
      `SELECT count(*) FROM sessions WHERE token_hash = $1`,
      [tokenHash],
    );
    expect(parseInt(sessionCount.rows[0]!.count, 10)).toBe(0);
  });
});
