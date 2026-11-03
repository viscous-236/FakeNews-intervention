/** TEST-102: pinned local model, real HTTP, real database, real container restart. */
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../../src/config.js';
import { closePool } from '../../src/db/pool.js';
import { checkDetectorHealth, predict } from '../../src/detection/client.js';
import { getDetectorStatus } from '../../src/detection/admin.js';
import { runDetectionWorkerOnce } from '../../src/detection/worker.js';
import { createPost, editPost } from '../../src/modules/posts/service.js';
import { notificationBus } from '../../src/modules/notifications/bus.js';
import { getReadiness } from '../../src/modules/health/readiness.js';
import { createTestUser } from '../setup/factories.js';
import { closeTestPool, getTestPool, truncateAll } from '../setup/db.js';

describe('Real detector integration', () => {
  const threshold = config.FAKE_THRESHOLD_HIGH;
  const container = process.env.REAL_DETECTOR_CONTAINER;
  let author: { id: string; q: string; role: 'user' };

  async function waitForDetector(): Promise<void> {
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        const health = await checkDetectorHealth({ timeoutMs: 1000 });
        if (health.ok && health.modelLoaded) return;
      } catch {
        /* Container is starting. */
      }
      await delay(1000);
    }
    throw new Error('Real detector did not become ready');
  }

  beforeAll(async () => {
    if (!container) {
      throw new Error(
        'Start a dedicated detector container and set REAL_DETECTOR_CONTAINER and DETECTOR_URL; this suite restarts that container.',
      );
    }
    await waitForDetector();
    // Exercise notification behavior deterministically with real model output.
    // No prediction value is replaced: the backend threshold is configurable.
    config.FAKE_THRESHOLD_HIGH = 0;
  }, 90_000);

  beforeEach(async () => {
    await truncateAll();
    const user = await createTestUser();
    author = { id: user.id, q: user.q, role: 'user' };
  });

  afterAll(async () => {
    config.FAKE_THRESHOLD_HIGH = threshold;
    await closePool();
    await closeTestPool();
  });

  it('exposes real model metadata and readiness', async () => {
    const status = await getDetectorStatus();
    expect(status.health).toEqual({ ok: true, modelLoaded: true });
    expect(status.modelInfo?.model_version).toBe(
      'hamzab-roberta-fake-news-classification-648014ea',
    );
    expect(status.modelInfo?.label_mapping).toEqual({ '0': 'FAKE', '1': 'TRUE' });
    expect(await getReadiness()).toEqual({ db: true, migrations: true, detector: true });
  });

  it('stores real predictions for each revision and notifies only after commit for the current one', async () => {
    const body = 'A short political claim for local inference.';
    const editedBody = 'A different political statement, requiring another automated check.';
    const post = await createPost(author, { body });
    await editPost(post.id, author.id, { body: editedBody });
    const notifications: unknown[] = [];
    const committed: Promise<number | null>[] = [];
    const listener = (notification: { id: string }): void => {
      notifications.push(notification);
      committed.push(
        getTestPool()
          .query('SELECT id FROM notifications WHERE id = $1', [notification.id])
          .then((result) => result.rowCount),
      );
    };
    notificationBus.on(`notification:${author.id}`, listener);
    try {
      expect(await runDetectionWorkerOnce()).toBe(true);
      expect(notifications).toHaveLength(0);
      expect(await runDetectionWorkerOnce()).toBe(true);
      expect(notifications).toHaveLength(1);
      expect(await Promise.all(committed)).toEqual([1]);
      expect(await runDetectionWorkerOnce()).toBe(false);
    } finally {
      notificationBus.off(`notification:${author.id}`, listener);
    }
    const result = await getTestPool().query(
      'SELECT * FROM detection_results WHERE post_id = $1 ORDER BY post_revision',
      [post.id],
    );
    expect(result.rows).toHaveLength(2);
    for (const row of result.rows) {
      expect(row).toMatchObject({
        status: 'ok',
        model_version: 'hamzab-roberta-fake-news-classification-648014ea',
        band: 'likely_fake',
        attempts: 0,
        locked_at: null,
      });
      const direct = await predict({
        requestId: row.request_id,
        postId: post.id,
        text: row.post_revision === 1 ? body : editedBody,
      });
      expect(Number(row.p_fake)).toBeCloseTo(direct.pFake, 4);
      expect(row.raw_response.request_id).toBe(row.request_id);
    }
    expect((await getTestPool().query('SELECT * FROM assessments')).rows).toHaveLength(0);
    expect((await getTestPool().query('SELECT * FROM reputation_events')).rows).toHaveLength(0);
    expect((await getTestPool().query('SELECT q FROM users WHERE q <> 0')).rows).toHaveLength(0);
  }, 90_000);

  it('retries successfully after the actual detector container stops and restarts', async () => {
    const post = await createPost(author, { body: 'A claim queued during a detector outage.' });
    execFileSync('docker', ['stop', '--time', '10', container!], { timeout: 30_000 });
    try {
      expect(await runDetectionWorkerOnce()).toBe(true);
      const result = await getTestPool().query(
        'SELECT * FROM detection_results WHERE post_id = $1',
        [post.id],
      );
      expect(result.rows[0]).toMatchObject({
        status: 'failed',
        attempts: 1,
        p_fake: null,
        band: null,
      });
    } finally {
      execFileSync('docker', ['start', container!], { timeout: 30_000 });
    }
    await waitForDetector();
    await getTestPool().query(
      'UPDATE detection_results SET next_attempt_at = now() WHERE post_id = $1',
      [post.id],
    );
    expect(await runDetectionWorkerOnce()).toBe(true);
    const result = await getTestPool().query('SELECT * FROM detection_results WHERE post_id = $1', [
      post.id,
    ]);
    expect(result.rows[0]).toMatchObject({
      status: 'ok',
      attempts: 1,
      error_code: null,
      model_version: 'hamzab-roberta-fake-news-classification-648014ea',
    });
  }, 120_000);
});
