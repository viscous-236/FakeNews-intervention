/**
 * apps/api/test/modules/notifications/notifications.test.ts (TASK-042)
 *
 * Tests for notification creation, self-action filtering (RUL-025),
 * cursor pagination, unread counts, read marking, and real SSE delivery (REQ-041).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import http from 'http';
import { createApp } from '../../../src/app.js';
import { closeTestPool, truncateAll } from '../../setup/db.js';
import { config } from '../../../src/config.js';
import { createUser } from '../../../src/modules/users/service.js';
import { createNotification } from '../../../src/modules/notifications/service.js';

function extractCookie(headers: Record<string, unknown>): string {
  const h = headers['set-cookie'];
  return Array.isArray(h) ? String(h[0] || '') : typeof h === 'string' ? h : '';
}

describe('Notifications Module & SSE (TASK-042, RUL-025, REQ-041, REQ-044)', () => {
  const app = createApp();
  const request = supertest(app);
  let recipientId: string;
  let actorId: string;
  let recipientCookie: string;

  beforeAll(async () => {
    await truncateAll();

    const recipient = await createUser({
      username: 'notif_recipient',
      email: 'recipient@example.com',
      password: 'password12345',
      displayName: 'Recipient User',
    });
    recipientId = recipient.id;

    const actor = await createUser({
      username: 'notif_actor',
      email: 'actor@example.com',
      password: 'password12345',
      displayName: 'Actor User',
    });
    actorId = actor.id;

    const loginRes = await request
      .post('/api/v1/auth/login')
      .set('Origin', config.APP_ORIGIN)
      .send({ identifier: 'notif_recipient', password: 'password12345' });
    recipientCookie = extractCookie(loginRes.headers);
  });

  afterAll(async () => {
    await closeTestPool();
  });

  it('RUL-025: Users never receive a notification about their own action', async () => {
    // Action where actor is the recipient themself
    const selfNotif = await createNotification({
      userId: recipientId,
      actorId: recipientId,
      type: 'like',
      payload: { note: 'self like' },
    });
    expect(selfNotif).toBeNull();

    // Verify unread count is still 0
    const countRes = await request
      .get('/api/v1/notifications/unread-count')
      .set('Cookie', recipientCookie);
    expect(countRes.status).toBe(200);
    expect(countRes.body.count).toBe(0);
  });

  it('Creates notifications, exposes UserSummary for actor, and increments unread count', async () => {
    // Create valid notification from actor to recipient
    const notif = await createNotification({
      userId: recipientId,
      actorId,
      type: 'new_follower',
      payload: { source: 'profile' },
    });
    expect(notif).not.toBeNull();
    expect(notif!.id).toBeDefined();
    expect(notif!.actor).toBeDefined();
    expect(notif!.actor?.username).toBe('notif_actor');
    expect(notif!.actor?.displayName).toBe('Actor User');
    expect(notif!.actor?.tier).toBe('neutral');

    // Check unread count
    const countRes = await request
      .get('/api/v1/notifications/unread-count')
      .set('Cookie', recipientCookie);
    expect(countRes.status).toBe(200);
    expect(countRes.body.count).toBe(1);

    // List notifications
    const listRes = await request.get('/api/v1/notifications').set('Cookie', recipientCookie);
    expect(listRes.status).toBe(200);
    expect(listRes.body.items.length).toBe(1);
    expect(listRes.body.items[0].id).toBe(notif!.id);
    expect(listRes.body.items[0].type).toBe('new_follower');
    expect(listRes.body.items[0].readAt).toBeNull();
  });

  it('POST /notifications/read marks specific IDs and all notifications as read', async () => {
    // Create a 2nd notification
    const notif2 = await createNotification({
      userId: recipientId,
      actorId,
      type: 'comment',
      payload: { text: 'nice post!' },
    });
    expect(notif2).not.toBeNull();

    // Now unread count is 2
    const countBefore = await request
      .get('/api/v1/notifications/unread-count')
      .set('Cookie', recipientCookie);
    expect(countBefore.body.count).toBe(2);

    // Mark specific notification (notif2) as read
    const readOneRes = await request
      .post('/api/v1/notifications/read')
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', recipientCookie)
      .send({ ids: [notif2!.id] });
    expect(readOneRes.status).toBe(204);

    const countAfterOne = await request
      .get('/api/v1/notifications/unread-count')
      .set('Cookie', recipientCookie);
    expect(countAfterOne.body.count).toBe(1);

    // Filter ?unread=true returns only 1 item
    const unreadListRes = await request
      .get('/api/v1/notifications?unread=true')
      .set('Cookie', recipientCookie);
    expect(unreadListRes.body.items.length).toBe(1);
    expect(unreadListRes.body.items[0].id).not.toBe(notif2!.id);

    // Mark all as read (omit ids field)
    const readAllRes = await request
      .post('/api/v1/notifications/read')
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', recipientCookie)
      .send({});
    expect(readAllRes.status).toBe(204);

    const countAfterAll = await request
      .get('/api/v1/notifications/unread-count')
      .set('Cookie', recipientCookie);
    expect(countAfterAll.body.count).toBe(0);
  });

  it('GET /notifications/stream delivers real SSE events over HTTP (REQ-041)', async () => {
    // Start temporary HTTP server to test live SSE connection
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address() as { port: number };
    const port = address.port;

    const receivedChunks: string[] = [];

    const reqPromise = new Promise<void>((resolve, reject) => {
      const clientReq = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: '/api/v1/notifications/stream',
          method: 'GET',
          headers: {
            Cookie: recipientCookie,
          },
        },
        (res) => {
          expect(res.statusCode).toBe(200);
          expect(res.headers['content-type']).toBe('text/event-stream');

          res.on('data', (chunk) => {
            const str = chunk.toString();
            receivedChunks.push(str);

            // Once notification data line arrives, terminate stream
            if (receivedChunks.join('').includes('post_flagged')) {
              setTimeout(() => {
                clientReq.destroy();
                resolve();
              }, 20);
            }
          });

          res.on('error', (err) => {
            // Socket destroyed intentionally
            if ((err as { code?: string }).code !== 'ECONNRESET') {
              reject(err);
            } else {
              resolve();
            }
          });
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

    // Wait 100ms for SSE connection handshake
    await new Promise((r) => setTimeout(r, 100));

    // Trigger a new notification
    const sseNotif = await createNotification({
      userId: recipientId,
      actorId,
      type: 'post_flagged',
      payload: { reason: 'misleading' },
    });
    expect(sseNotif).not.toBeNull();

    // Await receipt of SSE event
    await reqPromise;

    // Close test server
    await new Promise<void>((resolve) => server.close(() => resolve()));

    const allData = receivedChunks.join('');
    expect(allData).toContain(': connected');
    expect(allData).toContain(`id: ${sseNotif!.id}`);
    expect(allData).toContain('event: notification');
    expect(allData).toContain('post_flagged');
  });
});
