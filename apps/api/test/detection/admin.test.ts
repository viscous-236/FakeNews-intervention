import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../../src/app.js';
import { config } from '../../src/config.js';
import { closePool } from '../../src/db/pool.js';
import { createTestUser } from '../setup/factories.js';
import { closeTestPool, getTestPool, truncateAll } from '../setup/db.js';

describe('Detection administration and readiness (TASK-051)', () => {
  const request = supertest(createApp());
  const originalUrl = config.DETECTOR_URL;
  let adminCookie: string;
  let userCookie: string;
  let postId: string;
  let detectionId: string;
  let adminId: string;

  async function session(userId: string): Promise<string> {
    const token = randomBytes(32).toString('hex');
    await getTestPool().query(
      `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 day')`,
      [userId, createHash('sha256').update(token).digest('hex')],
    );
    return `${config.SESSION_COOKIE_NAME}=${token}`;
  }

  beforeAll(async () => {
    await truncateAll();
    const admin = await createTestUser({ role: 'admin' });
    const user = await createTestUser();
    adminId = admin.id;
    adminCookie = await session(admin.id);
    userCookie = await session(user.id);
    const post = await getTestPool().query<{ id: string }>(
      `INSERT INTO posts (author_id, kind, body, author_tier_at_post, revision)
       VALUES ($1, 'original', 'A post for detector administration tests.', 'neutral', 2) RETURNING id`,
      [user.id],
    );
    postId = post.rows[0]!.id;
    // A closed loopback port exercises a real connection failure, not a mocked detector.
    const socket = createServer();
    await new Promise<void>((resolve) => socket.listen(0, '127.0.0.1', resolve));
    const address = socket.address();
    if (!address || typeof address === 'string') throw new Error('Missing port');
    config.DETECTOR_URL = `http://127.0.0.1:${address.port}`;
    await new Promise<void>((resolve) => socket.close(() => resolve()));
  });

  afterAll(async () => {
    config.DETECTOR_URL = originalUrl;
    await closePool();
    await closeTestPool();
  });

  it.each([
    ['post', 'redetect'],
    ['detection', 'requeue'],
  ])('requires administrator authorization for %s %s', async (kind, action) => {
    const path =
      kind === 'post'
        ? `/api/v1/admin/posts/${postId}/${action}`
        : `/api/v1/admin/detections/${randomUUID()}/${action}`;
    expect((await request.post(path).set('Origin', config.APP_ORIGIN)).status).toBe(401);
    expect(
      (await request.post(path).set('Origin', config.APP_ORIGIN).set('Cookie', userCookie)).status,
    ).toBe(403);
  });

  it('queues the current revision and audits the action without changing scores', async () => {
    const response = await request
      .post(`/api/v1/admin/posts/${postId}/redetect`)
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', adminCookie);
    expect(response.status).toBe(202);
    detectionId = response.body.detectionId;
    const row = await getTestPool().query('SELECT * FROM detection_results WHERE id = $1', [
      detectionId,
    ]);
    expect(row.rows[0]).toMatchObject({
      post_id: postId,
      post_revision: 2,
      status: 'queued',
      attempts: 0,
    });
    const audit = await getTestPool().query(
      `SELECT actor_id, after FROM admin_audit_log WHERE action = 'post.redetect'`,
    );
    expect(audit.rows[0]).toMatchObject({ actor_id: adminId, after: { detectionId, revision: 2 } });
    expect((await getTestPool().query('SELECT * FROM assessments')).rows).toHaveLength(0);
    expect((await getTestPool().query('SELECT * FROM reputation_events')).rows).toHaveLength(0);
    expect((await getTestPool().query('SELECT q FROM users WHERE q <> 0')).rows).toHaveLength(0);
  });

  it('rejects invalid IDs, missing posts, and reshared targets', async () => {
    for (const [id, expected] of [
      ['not-a-uuid', 400],
      [randomUUID(), 404],
    ] as const) {
      const response = await request
        .post(`/api/v1/admin/posts/${id}/redetect`)
        .set('Origin', config.APP_ORIGIN)
        .set('Cookie', adminCookie);
      expect(response.status).toBe(expected);
    }
    const reshare = await getTestPool().query<{ id: string }>(
      `INSERT INTO posts (author_id, kind, reshare_of_post_id, author_tier_at_post)
       VALUES ($1, 'reshare', $2, 'neutral') RETURNING id`,
      [adminId, postId],
    );
    const response = await request
      .post(`/api/v1/admin/posts/${reshare.rows[0]!.id}/redetect`)
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', adminCookie);
    expect(response.status).toBe(400);
  });

  it('requeues permanent failures once, resets retry state, and audits the change', async () => {
    const path = `/api/v1/admin/detections/${detectionId}/requeue`;
    expect(
      (await request.post(path).set('Origin', config.APP_ORIGIN).set('Cookie', adminCookie)).status,
    ).toBe(409);
    await getTestPool().query(
      `UPDATE detection_results SET status = 'failed_permanent', attempts = 3,
       error_code = 'TIMEOUT', error_detail = 'Timed out', completed_at = now() WHERE id = $1`,
      [detectionId],
    );
    const responses = await Promise.all(
      Array.from({ length: 2 }, () =>
        request.post(path).set('Origin', config.APP_ORIGIN).set('Cookie', adminCookie),
      ),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([202, 409]);
    const row = await getTestPool().query('SELECT * FROM detection_results WHERE id = $1', [
      detectionId,
    ]);
    expect(row.rows[0]).toMatchObject({
      status: 'queued',
      attempts: 0,
      error_code: null,
      error_detail: null,
      completed_at: null,
      locked_at: null,
    });
    const audit = await getTestPool().query(
      `SELECT before, after FROM admin_audit_log WHERE action = 'detection.requeue'`,
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toEqual({
      before: { status: 'failed_permanent', attempts: 3 },
      after: { status: 'queued', attempts: 0 },
    });
  });

  it('reports detector unavailability while keeping the application ready', async () => {
    expect((await request.get('/api/v1/admin/detector/status')).status).toBe(401);
    expect(
      (await request.get('/api/v1/admin/detector/status').set('Cookie', userCookie)).status,
    ).toBe(403);
    const status = await request.get('/api/v1/admin/detector/status').set('Cookie', adminCookie);
    expect(status.status).toBe(200);
    expect(status.body).toEqual({ health: { ok: false, modelLoaded: false }, modelInfo: null });
    const ready = await request.get('/readyz');
    expect(ready.status).toBe(200);
    expect(ready.body).toEqual({ db: true, migrations: true, detector: false });
  });

  it('fails readiness for an unapplied migration even if the ledger count is unchanged', async () => {
    const pool = getTestPool();
    await pool.query(
      `UPDATE pgmigrations SET name = 'unrelated_migration' WHERE name = '0005_search_and_views'`,
    );
    try {
      const response = await request.get('/readyz');
      expect(response.status).toBe(503);
      expect(response.body).toEqual({ db: true, migrations: false, detector: false });
    } finally {
      await pool.query(
        `UPDATE pgmigrations SET name = '0005_search_and_views' WHERE name = 'unrelated_migration'`,
      );
    }
  });

  it('returns 503 when the database connection fails', async () => {
    const databaseUrl = config.DATABASE_URL;
    await closePool();
    const unavailable = new URL(databaseUrl);
    unavailable.pathname = '/missing_readiness_test_database';
    config.DATABASE_URL = unavailable.toString();
    try {
      const response = await request.get('/readyz');
      expect(response.status).toBe(503);
      expect(response.body).toEqual({ db: false, migrations: false, detector: false });
    } finally {
      await closePool();
      config.DATABASE_URL = databaseUrl;
    }
  });
});
