/**
 * apps/api/test/middleware/auth.test.ts (TASK-037, SEC-002, SEC-010)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import supertest from 'supertest';
import crypto from 'crypto';
import { getTestPool, closeTestPool, truncateAll } from '../setup/db.js';
import { createUser } from '../../src/modules/users/service.js';
import {
  requireAuth,
  requireActive,
  requireAdmin,
} from '../../src/middleware/auth.js';
import { errorHandler } from '../../src/middleware/errors.js';
import { config } from '../../src/config.js';

describe('auth middleware (SEC-002, SEC-010)', () => {
  const app = express();
  app.use(cookieParser());

  app.get('/auth-only', requireAuth, (req, res) => {
    res.json({ user: req.user?.username });
  });

  app.get('/active-only', requireActive, (req, res) => {
    res.json({ user: req.user?.username, status: req.user?.status });
  });

  app.get('/admin-only', requireAdmin, (req, res) => {
    res.json({ user: req.user?.username, role: req.user?.role });
  });

  app.use(errorHandler);
  const request = supertest(app);

  beforeAll(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await closeTestPool();
  });

  async function createSession(userId: string, expiresAt: Date): Promise<string> {
    const rawToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const pool = getTestPool();
    await pool.query(
      `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
      [userId, tokenHash, expiresAt],
    );
    return rawToken;
  }

  it('requireAuth rejects with 401 UNAUTHENTICATED when no cookie present', async () => {
    const res = await request.get('/auth-only');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('requireAuth rejects with 401 UNAUTHENTICATED when invalid session token provided', async () => {
    const res = await request
      .get('/auth-only')
      .set('Cookie', `${config.SESSION_COOKIE_NAME}=invalid_random_token_value`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('requireAuth rejects with 401 UNAUTHENTICATED when session has expired', async () => {
    const user = await createUser({
      username: 'expired_user',
      email: 'expired@example.com',
      password: 'password12345',
      displayName: 'Expired User',
      emailVerified: true,
    });

    const expiredToken = await createSession(
      user.id,
      new Date(Date.now() - 1000 * 60), // 1 minute in the past
    );

    const res = await request
      .get('/auth-only')
      .set('Cookie', `${config.SESSION_COOKIE_NAME}=${expiredToken}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('requireAuth succeeds with 200 on valid unexpired session', async () => {
    const user = await createUser({
      username: 'valid_user',
      email: 'valid@example.com',
      password: 'password12345',
      displayName: 'Valid User',
      emailVerified: true,
    });

    const token = await createSession(
      user.id,
      new Date(Date.now() + 1000 * 60 * 60), // 1 hour in the future
    );

    const res = await request
      .get('/auth-only')
      .set('Cookie', `${config.SESSION_COOKIE_NAME}=${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user).toBe('valid_user');
  });

  it('requireActive rejects with 403 EMAIL_NOT_VERIFIED when email is unverified', async () => {
    const user = await createUser({
      username: 'unverified_user',
      email: 'unverified@example.com',
      password: 'password12345',
      displayName: 'Unverified User',
      emailVerified: false,
    });

    const token = await createSession(
      user.id,
      new Date(Date.now() + 1000 * 60 * 60),
    );

    const res = await request
      .get('/active-only')
      .set('Cookie', `${config.SESSION_COOKIE_NAME}=${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('requireActive rejects with 403 ACCOUNT_SUSPENDED when user is suspended', async () => {
    const user = await createUser({
      username: 'suspended_user',
      email: 'suspended@example.com',
      password: 'password12345',
      displayName: 'Suspended User',
      emailVerified: true,
    });

    const pool = getTestPool();
    await pool.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [user.id]);

    const token = await createSession(
      user.id,
      new Date(Date.now() + 1000 * 60 * 60),
    );

    const res = await request
      .get('/active-only')
      .set('Cookie', `${config.SESSION_COOKIE_NAME}=${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_SUSPENDED');
  });

  it('requireAdmin rejects regular user with 403 FORBIDDEN', async () => {
    const user = await createUser({
      username: 'regular_user',
      email: 'regular@example.com',
      password: 'password12345',
      displayName: 'Regular User',
      role: 'user',
      emailVerified: true,
    });

    const token = await createSession(
      user.id,
      new Date(Date.now() + 1000 * 60 * 60),
    );

    const res = await request
      .get('/admin-only')
      .set('Cookie', `${config.SESSION_COOKIE_NAME}=${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('requireAdmin allows admin user with 200', async () => {
    const admin = await createUser({
      username: 'admin_user',
      email: 'admin_mw@example.com',
      password: 'password12345',
      displayName: 'Admin User',
      role: 'admin',
      emailVerified: true,
    });

    const token = await createSession(
      admin.id,
      new Date(Date.now() + 1000 * 60 * 60),
    );

    const res = await request
      .get('/admin-only')
      .set('Cookie', `${config.SESSION_COOKIE_NAME}=${token}`);
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('admin');
  });
});
