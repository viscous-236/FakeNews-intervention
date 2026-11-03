/** TEST-101: real PostgreSQL plus the PLAN's test-only HTTP fault server. */
import { createServer, type Server, type ServerResponse } from 'node:http';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFaultServer, type FaultMode } from '../../../../tools/fault-server/server.js';
import { config } from '../../src/config.js';
import { closePool } from '../../src/db/pool.js';
import { runDetectionWorkerOnce } from '../../src/detection/worker.js';
import { createTestUser } from '../setup/factories.js';
import { closeTestPool, getTestPool, truncateAll } from '../setup/db.js';

describe('Detection worker failure isolation', () => {
  const originalUrl = config.DETECTOR_URL;
  const originalTimeout = config.DETECTOR_TIMEOUT_MS;
  let server: Server;
  let detectionId: string;
  let postId: string;
  let predictionCalls: number;
  let sentText: string;

  async function serve(mode: FaultMode): Promise<void> {
    server = createFaultServer({ mode });
    server.on('request', (req) => {
      if (req.url !== '/v1/predict') return;
      predictionCalls++;
      let body = '';
      req.on('data', (chunk) => {
        body += String(chunk);
      });
      req.on('end', () => {
        sentText = JSON.parse(body).text;
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing port');
    config.DETECTOR_URL = `http://127.0.0.1:${address.port}`;
  }

  beforeEach(async () => {
    await truncateAll();
    predictionCalls = 0;
    sentText = '';
    config.DETECTOR_TIMEOUT_MS = 150;
    const author = await createTestUser();
    const post = await getTestPool().query<{ id: string }>(
      `INSERT INTO posts (author_id, kind, body, author_tier_at_post)
       VALUES ($1, 'original', 'Original claim before any edits.', 'neutral') RETURNING id`,
      [author.id],
    );
    postId = post.rows[0]!.id;
    const job = await getTestPool().query<{ id: string }>(
      `INSERT INTO detection_results (post_id, post_revision) VALUES ($1, 1) RETURNING id`,
      [postId],
    );
    detectionId = job.rows[0]!.id;
  });

  afterEach(async () => {
    config.DETECTOR_URL = originalUrl;
    config.DETECTOR_TIMEOUT_MS = originalTimeout;
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  afterAll(async () => {
    await closePool();
    await closeTestPool();
  });

  it.each<[FaultMode, string]>([
    ['http-401', 'HTTP_401'],
    ['http-422', 'HTTP_422'],
    ['http-500', 'HTTP_5XX'],
    ['timeout', 'TIMEOUT'],
    ['network-error', 'NETWORK'],
    ['malformed', 'MALFORMED_RESPONSE'],
    ['mismatch', 'REQUEST_ID_MISMATCH'],
    ['out-of-range', 'MALFORMED_RESPONSE'],
    ['warmup-failure', 'HTTP_5XX'],
  ])(
    '%s retries with backoff, stops permanently, and creates no score effects',
    async (mode, code) => {
      await serve(mode);
      const pool = getTestPool();
      for (let attempt = 1; attempt <= config.DETECTOR_MAX_ATTEMPTS; attempt++) {
        const start = Date.now();
        expect(await runDetectionWorkerOnce()).toBe(true);
        const result = await pool.query('SELECT * FROM detection_results WHERE id = $1', [
          detectionId,
        ]);
        const row = result.rows[0]!;
        const permanent = attempt === config.DETECTOR_MAX_ATTEMPTS;
        expect(row).toMatchObject({
          status: permanent ? 'failed_permanent' : 'failed',
          attempts: attempt,
          error_code: code,
          p_fake: null,
          band: null,
          locked_at: null,
        });
        if (!permanent) {
          expect(row.next_attempt_at.getTime()).toBeGreaterThanOrEqual(
            start + config.DETECTOR_BACKOFF_SECONDS[attempt - 1]! * 1000 - 100,
          );
        }
        expect(await runDetectionWorkerOnce()).toBe(false);
        await pool.query('UPDATE detection_results SET next_attempt_at = now() WHERE id = $1', [
          detectionId,
        ]);
      }
      expect(await runDetectionWorkerOnce()).toBe(false);
      expect(predictionCalls).toBe(mode === 'warmup-failure' ? 0 : config.DETECTOR_MAX_ATTEMPTS);
      for (const table of ['assessments', 'reputation_events', 'notifications']) {
        expect((await pool.query(`SELECT * FROM ${table}`)).rows).toHaveLength(0);
      }
      expect((await pool.query('SELECT q FROM users WHERE q <> 0')).rows).toHaveLength(0);
      expect(
        (await pool.query('SELECT label FROM post_public_status_v WHERE post_id = $1', [postId]))
          .rows[0].label,
      ).toBe('none');
    },
  );

  it('uses historical text for a queued old revision', async () => {
    await serve('http-500');
    await getTestPool().query(
      `INSERT INTO post_revisions (post_id, revision, body)
       SELECT id, revision, body FROM posts WHERE id = $1`,
      [postId],
    );
    await getTestPool().query(
      `UPDATE posts SET revision = 2, body = 'Changed claim after the edit.' WHERE id = $1`,
      [postId],
    );
    await runDetectionWorkerOnce();
    expect(sentText).toBe('Original claim before any edits.');
  });

  it('recovers stale running jobs without reclaiming a fresh lease', async () => {
    await serve('http-500');
    await getTestPool().query(
      `UPDATE detection_results SET status = 'running', locked_at = now() WHERE id = $1`,
      [detectionId],
    );
    expect(await runDetectionWorkerOnce()).toBe(false);
    await getTestPool().query(
      `UPDATE detection_results SET locked_at = now() - interval '121 seconds' WHERE id = $1`,
      [detectionId],
    );
    expect(await runDetectionWorkerOnce()).toBe(true);
    expect(predictionCalls).toBe(1);
  });

  it('skips a locked queued job and permits only one concurrent claim', async () => {
    await serve('http-500');
    const tx = await getTestPool().connect();
    try {
      await tx.query('BEGIN');
      await tx.query('SELECT id FROM detection_results WHERE id = $1 FOR UPDATE', [detectionId]);
      expect(await runDetectionWorkerOnce()).toBe(false);
    } finally {
      await tx.query('ROLLBACK');
      tx.release();
    }
    const results = await Promise.all(Array.from({ length: 5 }, () => runDetectionWorkerOnce()));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(predictionCalls).toBe(1);
  });

  it('does not let an expired worker overwrite a replacement lease', async () => {
    let received!: (res: ServerResponse) => void;
    const pending = new Promise<ServerResponse>((resolve) => {
      received = resolve;
    });
    server = createServer((req, res) => {
      if (req.url === '/healthz') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ status: 'ok', model_loaded: true }));
      } else {
        received(res);
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing port');
    config.DETECTOR_URL = `http://127.0.0.1:${address.port}`;
    config.DETECTOR_TIMEOUT_MS = 5000;
    const running = runDetectionWorkerOnce();
    const response = await pending;
    await getTestPool().query(
      `UPDATE detection_results SET locked_at = locked_at + interval '1 second' WHERE id = $1`,
      [detectionId],
    );
    response.writeHead(500);
    response.end('{}');
    await running;
    const result = await getTestPool().query(
      'SELECT status, attempts FROM detection_results WHERE id = $1',
      [detectionId],
    );
    expect(result.rows[0]).toEqual({ status: 'running', attempts: 0 });
  });
});
