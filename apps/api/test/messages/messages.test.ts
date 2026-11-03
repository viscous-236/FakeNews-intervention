/** Direct-message REST and WebSocket flows (TASK-071–072). */

import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import WebSocket from 'ws';
import { createApp } from '../../src/app.js';
import { config } from '../../src/config.js';
import { closePool } from '../../src/db/pool.js';
import { attachWebSocketServer } from '../../src/realtime/ws.js';
import { closeAllConnections } from '../../src/realtime/hub.js';
import { closeTestPool, getTestPool, truncateAll } from '../setup/db.js';
import { createTestUser } from '../setup/factories.js';

function waitForMessage(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const onMessage = (data: WebSocket.RawData): void => {
      cleanup();
      resolve(JSON.parse(data.toString()) as Record<string, unknown>);
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const cleanup = (): void => {
      socket.off('message', onMessage);
      socket.off('error', onError);
    };
    socket.once('message', onMessage);
    socket.once('error', onError);
  });
}

async function connectSocket(port: number, cookie: string): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
    headers: { Origin: config.APP_ORIGIN, Cookie: cookie },
  });
  const ready = waitForMessage(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
  await expect(ready).resolves.toMatchObject({ type: 'ready' });
  return socket;
}

describe('Direct messages (TASK-071–072)', () => {
  const request = supertest(createApp());
  let server: Server;
  let port: number;

  async function session(userId: string): Promise<string> {
    const token = randomBytes(32).toString('hex');
    await getTestPool().query(
      `INSERT INTO sessions (user_id, token_hash, expires_at)
       VALUES ($1, $2, now() + interval '1 day')`,
      [userId, createHash('sha256').update(token).digest('hex')],
    );
    return `${config.SESSION_COOKIE_NAME}=${token}`;
  }

  beforeAll(async () => {
    await truncateAll();
    server = createServer(createApp());
    attachWebSocketServer(server);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    port = (server.address() as { port: number }).port;
  });

  afterAll(async () => {
    closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closePool();
    await closeTestPool();
  });

  it('sends through REST, delivers over WebSocket, tracks conversations, and marks read', async () => {
    const alice = await createTestUser({ username: 'message_alice' });
    const bob = await createTestUser({ username: 'message_bob' });
    const aliceCookie = await session(alice.id);
    const bobCookie = await session(bob.id);

    const bobSocket = await connectSocket(port, bobCookie);

    const deliveredPromise = waitForMessage(bobSocket);
    const sent = await request
      .post(`/api/v1/messages/with/${bob.username}`)
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', aliceCookie)
      .send({ body: 'Hello from REST to the live socket.' });
    expect(sent.status).toBe(201);
    expect(sent.body).toMatchObject({ senderId: alice.id, recipientId: bob.id });

    const delivered = await deliveredPromise;
    expect(delivered).toMatchObject({ type: 'message', message: sent.body });

    const conversations = await request
      .get('/api/v1/messages/conversations')
      .set('Cookie', bobCookie);
    expect(conversations.status).toBe(200);
    expect(conversations.body.items[0]).toMatchObject({
      user: { id: alice.id, username: alice.username },
      unreadCount: 1,
    });

    const history = await request
      .get(`/api/v1/messages/with/${alice.username}`)
      .set('Cookie', bobCookie);
    expect(history.status).toBe(200);
    expect(history.body.items[0]).toMatchObject({ id: sent.body.id, body: sent.body.body });

    const aliceSocket = await connectSocket(port, aliceCookie);

    const readPromise = waitForMessage(aliceSocket);
    const marked = await request
      .post(`/api/v1/messages/with/${alice.username}/read`)
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', bobCookie);
    expect(marked.status).toBe(204);

    await expect(readPromise).resolves.toMatchObject({
      type: 'messages_read',
      readerId: bob.id,
      messageIds: [sent.body.id],
    });

    const afterRead = await request
      .get('/api/v1/messages/conversations')
      .set('Cookie', bobCookie);
    expect(afterRead.body.items[0].unreadCount).toBe(0);

    bobSocket.close();
    aliceSocket.close();
  });

  it('blocks messaging for blocked and suspended users', async () => {
    const sender = await createTestUser({ username: 'message_block_sender' });
    const target = await createTestUser({ username: 'message_block_target' });
    const senderCookie = await session(sender.id);
    await getTestPool().query(
      `INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)`,
      [target.id, sender.id],
    );

    const blocked = await request
      .post(`/api/v1/messages/with/${target.username}`)
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', senderCookie)
      .send({ body: 'This message must be rejected.' });
    expect(blocked.status).toBe(403);

    await getTestPool().query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [sender.id]);
    const suspended = await request
      .post(`/api/v1/messages/with/${target.username}`)
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', senderCookie)
      .send({ body: 'Suspended users cannot send.' });
    expect(suspended.status).toBe(403);
    expect(suspended.body.error.code).toBe('ACCOUNT_SUSPENDED');
  });

  it('rejects unauthenticated and wrong-origin WebSocket upgrades', async () => {
    const user = await createTestUser({ username: 'message_ws_user' });
    const cookie = await session(user.id);

    const unauthenticated = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
      headers: { Origin: config.APP_ORIGIN },
    });
    await expect(
      new Promise<void>((resolve, reject) => {
        unauthenticated.once('error', () => resolve());
        unauthenticated.once('open', () => reject(new Error('Unauthenticated socket opened')));
      }),
    ).resolves.toBeUndefined();

    const wrongOrigin = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
      headers: { Origin: 'https://evil.example', Cookie: cookie },
    });
    await expect(
      new Promise<void>((resolve, reject) => {
        wrongOrigin.once('error', () => resolve());
        wrongOrigin.once('open', () => reject(new Error('Wrong-origin socket opened')));
      }),
    ).resolves.toBeUndefined();
  });
});
