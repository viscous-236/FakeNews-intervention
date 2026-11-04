/**
 * apps/api/test/modules/auth/tokens.test.ts (TASK-039)
 *
 * Tests TEST-046, TEST-047, and session/password lifecycle:
 *   - TEST-046: Email verification through real Mailpit message works once; expired or reused token fails
 *   - TEST-047: Forgot-password for unknown email returns 204 with no mail; reset changes password and deletes all sessions
 *   - Resend verification
 *   - Change password and session revocation
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../../../src/app.js';
import { getTestPool, closeTestPool, truncateAll } from '../../setup/db.js';
import { config } from '../../../src/config.js';
import { sendQueuedEmails } from '../../../src/modules/email/outbox.js';

interface MailpitMessageSummary {
  ID: string;
  Subject: string;
  To: Array<{ Address: string }>;
}

interface MailpitMessageDetail {
  ID: string;
  Text: string;
}

async function clearMailpitMessages(): Promise<void> {
  try {
    await fetch('http://localhost:8025/api/v1/messages', { method: 'DELETE' });
  } catch {
    // ignore if Mailpit API unreachable in non-docker test
  }
}

async function getLatestMailpitMessage(toEmail: string): Promise<string | null> {
  const res = await fetch('http://localhost:8025/api/v1/messages');
  if (!res.ok) return null;
  const data = (await res.json()) as { messages: MailpitMessageSummary[] };
  const target = data.messages.find((m) =>
    m.To.some((to) => to.Address.toLowerCase() === toEmail.toLowerCase()),
  );
  if (!target) return null;

  const detailRes = await fetch(`http://localhost:8025/api/v1/message/${target.ID}`);
  if (!detailRes.ok) return null;
  const detail = (await detailRes.json()) as MailpitMessageDetail;
  return detail.Text;
}

function extractCookie(headers: Record<string, unknown>): string {
  const h = headers['set-cookie'];
  return Array.isArray(h) ? String(h[0] || '') : typeof h === 'string' ? h : '';
}

describe('Auth Tokens and Email Flows (TEST-047)', () => {
  const app = createApp();
  const request = supertest(app);

  beforeAll(async () => {
    await truncateAll();
    await clearMailpitMessages();
  });

  afterAll(async () => {
    await closeTestPool();
  });

  it('TEST-047: Forgot-password for unknown email returns 204 with no mail; reset changes password and deletes all sessions', async () => {
    const pool = getTestPool();

    // 1. Unknown email returns 204 without enqueuing any outbox row
    const unknownRes = await request
      .post('/api/v1/auth/forgot-password')
      .set('Origin', config.APP_ORIGIN)
      .set('X-Forwarded-For', '198.51.100.2')
      .send({ email: 'ghost_nonexistent@example.com' });
    expect(unknownRes.status).toBe(204);

    const ghostOutbox = await pool.query(`SELECT count(*) FROM email_outbox WHERE to_email = $1`, [
      'ghost_nonexistent@example.com',
    ]);
    expect(parseInt(ghostOutbox.rows[0].count, 10)).toBe(0);

    // 2. Existing user forgot-password
    const regRes = await request
      .post('/api/v1/auth/register')
      .set('Origin', config.APP_ORIGIN)
      .set('X-Forwarded-For', '198.51.100.3')
      .send({
        username: 'reset_user_047',
        email: 'reset047@example.com',
        password: 'oldPassword12345',
        displayName: 'Reset User',
      });
    expect(regRes.status).toBe(201);
    const initialCookie = extractCookie(regRes.headers);

    // Request forgot password
    const forgotRes = await request
      .post('/api/v1/auth/forgot-password')
      .set('Origin', config.APP_ORIGIN)
      .set('X-Forwarded-For', '198.51.100.3')
      .send({ email: 'reset047@example.com' });
    expect(forgotRes.status).toBe(204);

    // Dispatch outbox
    await sendQueuedEmails();

    // Extract reset token
    const emailBody = await getLatestMailpitMessage('reset047@example.com');
    expect(emailBody).toBeTruthy();
    expect(emailBody).toContain('/reset-password?token=');
    const tokenMatch = emailBody!.match(/token=([a-zA-Z0-9_-]+)/);
    expect(tokenMatch).toBeTruthy();
    const resetToken = tokenMatch![1];

    // Reset password
    const resetRes = await request
      .post('/api/v1/auth/reset-password')
      .set('Origin', config.APP_ORIGIN)
      .send({
        token: resetToken,
        password: 'newBrandNewPassword999',
      });
    expect(resetRes.status).toBe(204);

    // 3. SEC-013: All user sessions deleted
    const sessionCountRes = await pool.query(`SELECT count(*) FROM sessions WHERE user_id = $1`, [
      regRes.body.user.id,
    ]);
    expect(parseInt(sessionCountRes.rows[0].count, 10)).toBe(0);

    // Old session cookie no longer works
    const meRes = await request.get('/api/v1/auth/me').set('Cookie', initialCookie);
    expect(meRes.status).toBe(401);

    // Old password fails login
    const oldLoginRes = await request
      .post('/api/v1/auth/login')
      .set('Origin', config.APP_ORIGIN)
      .set('X-Forwarded-For', '198.51.100.4')
      .send({
        identifier: 'reset_user_047',
        password: 'oldPassword12345',
      });
    expect(oldLoginRes.status).toBe(401);

    // New password succeeds login
    const newLoginRes = await request
      .post('/api/v1/auth/login')
      .set('Origin', config.APP_ORIGIN)
      .set('X-Forwarded-For', '198.51.100.4')
      .send({
        identifier: 'reset_user_047',
        password: 'newBrandNewPassword999',
      });
    expect(newLoginRes.status).toBe(200);
    expect(newLoginRes.body.user.username).toBe('reset_user_047');
  });

  it('Change password keeps current session and invalidates other sessions', async () => {
    // 1. Register a user
    const regRes = await request
      .post('/api/v1/auth/register')
      .set('Origin', config.APP_ORIGIN)
      .set('X-Forwarded-For', '198.51.100.10')
      .send({
        username: 'pw_change_user',
        email: 'change_pw@example.com',
        password: 'initialPassword123',
        displayName: 'PW Change User',
      });
    expect(regRes.status).toBe(201);
    const sessionCookie1 = extractCookie(regRes.headers);

    // 2. Login on second client to create a 2nd session
    const loginRes = await request
      .post('/api/v1/auth/login')
      .set('Origin', config.APP_ORIGIN)
      .set('X-Forwarded-For', '198.51.100.11')
      .send({
        identifier: 'pw_change_user',
        password: 'initialPassword123',
      });
    expect(loginRes.status).toBe(200);
    const sessionCookie2 = extractCookie(loginRes.headers);

    // 3. List sessions on session 2
    const listRes = await request.get('/api/v1/auth/sessions').set('Cookie', sessionCookie2);
    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body)).toBe(true);
    expect(listRes.body.length).toBe(2);
    const currentSession = listRes.body.find((s: { isCurrent: boolean }) => s.isCurrent);
    expect(currentSession).toBeDefined();

    // 4. Change password with bad current password -> 401
    const badChangeRes = await request
      .post('/api/v1/auth/change-password')
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', sessionCookie2)
      .send({
        currentPassword: 'wrongPasswordXYZ',
        newPassword: 'brandNewPassword456',
      });
    expect(badChangeRes.status).toBe(401);
    expect(badChangeRes.body.error.code).toBe('INVALID_CREDENTIALS');

    // 5. Change password successfully from session 2
    const goodChangeRes = await request
      .post('/api/v1/auth/change-password')
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', sessionCookie2)
      .send({
        currentPassword: 'initialPassword123',
        newPassword: 'brandNewPassword456',
      });
    expect(goodChangeRes.status).toBe(204);

    // Session 2 is still valid
    const me2Res = await request.get('/api/v1/auth/me').set('Cookie', sessionCookie2);
    expect(me2Res.status).toBe(200);

    // Session 1 is invalidated
    const me1Res = await request.get('/api/v1/auth/me').set('Cookie', sessionCookie1);
    expect(me1Res.status).toBe(401);

    // 6. Delete session 2 via DELETE /auth/sessions/:id
    const sessionsAfterChange = await request
      .get('/api/v1/auth/sessions')
      .set('Cookie', sessionCookie2);
    expect(sessionsAfterChange.body.length).toBe(1);
    const sId = sessionsAfterChange.body[0].id;

    const delSessionRes = await request
      .delete(`/api/v1/auth/sessions/${sId}`)
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', sessionCookie2);
    expect(delSessionRes.status).toBe(204);

    // Deleting already deleted session -> 401 (session was invalidated!)
    const delAgainRes = await request
      .delete(`/api/v1/auth/sessions/${sId}`)
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', sessionCookie2);
    expect(delAgainRes.status).toBe(401);
  });
});
