/** Real-database governance policy regression tests (TASK-054–056). */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../../src/app.js';
import { config } from '../../src/config.js';
import { closePool } from '../../src/db/pool.js';
import { assessPost } from '../../src/modules/governance/assessments.js';
import { createReport } from '../../src/modules/governance/reports.js';
import { runAutoRealOnce } from '../../src/jobs/autoReal.js';
import { finalizeWave } from '../../src/scoring/finalizeWave.js';
import { notificationBus } from '../../src/modules/notifications/bus.js';
import { createTestUser } from '../setup/factories.js';
import { closeTestPool, getTestPool, truncateAll } from '../setup/db.js';

describe('Governance policy safeguards', () => {
  const request = supertest(createApp());
  let adminId: string;
  let authorId: string;
  let reporterId: string;
  let postId: string;
  let adminCookie: string;
  const rationale = 'Reviewed the claim and its primary sources.';

  async function post(author = authorId): Promise<string> {
    const result = await getTestPool().query<{ id: string }>(
      `INSERT INTO posts (author_id, kind, body, author_tier_at_post, created_at)
       VALUES ($1, 'original', 'A claim to assess under governance policy.', 'neutral',
         now() - interval '2 hours') RETURNING id`,
      [author],
    );
    return result.rows[0]!.id;
  }

  async function session(userId: string): Promise<string> {
    const token = randomBytes(32).toString('hex');
    await getTestPool().query(
      `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 day')`,
      [userId, createHash('sha256').update(token).digest('hex')],
    );
    return `${config.SESSION_COOKIE_NAME}=${token}`;
  }

  // Seed persisted detection state to test the auto-real policy, not model accuracy.
  // Real inference itself is exercised in detection/real-detector.test.ts.
  async function lowRiskDetection(): Promise<string> {
    const result = await getTestPool().query<{ id: string }>(
      `INSERT INTO detection_results (post_id, post_revision, status, p_fake, band, model_name, model_version)
       VALUES ($1, 1, 'ok', 0.1, 'likely_real', 'policy-fixture', 'policy-fixture') RETURNING id`,
      [postId],
    );
    return result.rows[0]!.id;
  }

  beforeEach(async () => {
    await truncateAll();
    adminId = (await createTestUser({ role: 'admin' })).id;
    authorId = (await createTestUser()).id;
    reporterId = (await createTestUser()).id;
    postId = await post();
    adminCookie = await session(adminId);
  });

  afterAll(async () => {
    await closePool();
    await closeTestPool();
  });

  it('enforces own-post, duplicate, missing, deleted, and held report restrictions', async () => {
    await expect(createReport(postId, authorId, { reason: 'other' })).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(createReport(randomUUID(), reporterId, { reason: 'other' })).rejects.toMatchObject(
      { statusCode: 404 },
    );
    await createReport(postId, reporterId, { reason: 'false_information' });
    await expect(createReport(postId, reporterId, { reason: 'other' })).rejects.toMatchObject({
      statusCode: 409,
      code: 'ALREADY_EXISTS',
    });
    const queue = await request.get('/api/v1/admin/queue').set('Cookie', adminCookie);
    expect(queue.body.items[0]).toMatchObject({ post: { id: postId }, reasons: ['reported'] });
    await getTestPool().query(`UPDATE posts SET status = 'held' WHERE id = $1`, [postId]);
    await expect(createReport(postId, reporterId, { reason: 'other' })).rejects.toMatchObject({
      statusCode: 404,
    });
    await getTestPool().query(
      `UPDATE posts SET status = 'deleted', deleted_at = now() WHERE id = $1`,
      [postId],
    );
    await expect(createReport(postId, reporterId, { reason: 'other' })).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it.each(['author', 'reporter', 'liker', 'retracted-liker', 'resharer', 'retracted-resharer'])(
    'rejects an administrator with a %s conflict, preserving history',
    async (kind) => {
      if (kind === 'author')
        await getTestPool().query('UPDATE posts SET author_id = $1 WHERE id = $2', [
          adminId,
          postId,
        ]);
      if (kind === 'reporter') await createReport(postId, adminId, { reason: 'other' });
      if (kind.includes('liker')) {
        await getTestPool().query(
          `INSERT INTO likes (user_id, post_id, deleted_at) VALUES ($1, $2, $3)`,
          [adminId, postId, kind.startsWith('retracted') ? new Date() : null],
        );
      }
      if (kind.includes('resharer')) {
        await getTestPool().query(
          `INSERT INTO posts (author_id, kind, reshare_of_post_id, author_tier_at_post, status)
           VALUES ($1, 'reshare', $2, 'neutral', $3)`,
          [adminId, postId, kind.startsWith('retracted') ? 'deleted' : 'published'],
        );
      }
      const response = await request
        .post(`/api/v1/admin/posts/${postId}/assessments`)
        .set('Origin', config.APP_ORIGIN)
        .set('Cookie', adminCookie)
        .send({ verdict: 'fake', rationale });
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('CONFLICT_OF_INTEREST');
      expect((await getTestPool().query('SELECT * FROM assessments')).rows).toHaveLength(0);
      expect((await getTestPool().query('SELECT * FROM admin_audit_log')).rows).toHaveLength(0);
    },
  );

  it('audits a fake assessment and notifies author, resharer, penalized liker and reporter after commit', async () => {
    const sharer = await createTestUser();
    const liker = await createTestUser();
    await getTestPool().query(
      `INSERT INTO posts (author_id, kind, reshare_of_post_id, author_tier_at_post)
       VALUES ($1, 'reshare', $2, 'neutral')`,
      [sharer.id, postId],
    );
    await getTestPool().query('INSERT INTO likes (user_id, post_id) VALUES ($1, $2)', [
      liker.id,
      postId,
    ]);
    await createReport(postId, reporterId, { reason: 'false_information' });
    const committed: Promise<number | null>[] = [];
    const listener = (notification: { id: string }): void => {
      committed.push(
        getTestPool()
          .query('SELECT id FROM notifications WHERE id = $1', [notification.id])
          .then((result) => result.rowCount),
      );
    };
    notificationBus.on(`notification:${liker.id}`, listener);
    let result;
    try {
      result = await assessPost(postId, adminId, { verdict: 'fake', rationale });
    } finally {
      notificationBus.off(`notification:${liker.id}`, listener);
    }
    expect(await Promise.all(committed)).toEqual([1]);
    expect(result.eventsCreated).toEqual(
      expect.arrayContaining([
        { kind: 'MISINFO_POST', count: 1 },
        { kind: 'MISINFO_RESHARE', count: 1 },
        { kind: 'MISINFO_LIKE', count: 1 },
        { kind: 'VALID_REPORT', count: 1 },
      ]),
    );
    const notifications = await getTestPool().query('SELECT user_id, type FROM notifications');
    expect(notifications.rows).toHaveLength(4);
    expect(notifications.rows).toEqual(
      expect.arrayContaining([
        { user_id: authorId, type: 'assessment_decided' },
        { user_id: sharer.id, type: 'assessment_decided' },
        { user_id: liker.id, type: 'assessment_decided' },
        { user_id: reporterId, type: 'report_resolved' },
      ]),
    );
    const audit = await getTestPool().query('SELECT * FROM admin_audit_log');
    expect(audit.rows[0]).toMatchObject({
      actor_id: adminId,
      action: 'assessment.decide',
      entity_id: result.assessment.id,
      before: null,
      after: { verdict: 'fake', rationale },
    });
    await expect(assessPost(postId, adminId, { verdict: 'fake', rationale })).rejects.toMatchObject(
      { statusCode: 409, code: 'ALREADY_EXISTS' },
    );
    expect((await getTestPool().query('SELECT * FROM admin_audit_log')).rows).toHaveLength(1);
  });

  it('can assess deleted original posts and rejects unrelated detection evidence', async () => {
    const detection = await lowRiskDetection();
    const otherPost = await post();
    await expect(
      assessPost(otherPost, adminId, { verdict: 'fake', rationale, detectionResultId: detection }),
    ).rejects.toMatchObject({ statusCode: 400 });
    await getTestPool().query(
      `UPDATE posts SET status = 'deleted', deleted_at = now() WHERE id = $1`,
      [postId],
    );
    const result = await assessPost(postId, adminId, { verdict: 'fake', rationale });
    expect(result.eventsCreated).toContainEqual({ kind: 'MISINFO_POST', count: 1 });
  });

  it('enforces the positive-event cap across concurrent assessments of different posts', async () => {
    const ids = await Promise.all(Array.from({ length: 6 }, () => post()));
    await Promise.all(ids.map((id) => assessPost(id, adminId, { verdict: 'real', rationale })));
    const result = await getTestPool().query(
      `SELECT status, count(*)::int AS count FROM reputation_events
       WHERE user_id = $1 AND kind = 'RESPONSIBLE_POST' GROUP BY status`,
      [authorId],
    );
    expect(result.rows).toEqual(
      expect.arrayContaining([
        { status: 'eligible', count: 5 },
        { status: 'voided', count: 1 },
      ]),
    );
  });

  it.each([
    'disabled',
    'held',
    'deleted',
    'recent',
    'suspended',
    'deleted-author',
    'reported',
    'resolved-report',
    'assessed',
    'old-assessment',
    'old-revision',
    'high-risk',
    'failed',
    'newer-queued',
    'no-detection',
    'reshare',
  ])('blocks auto-real when %s', async (condition) => {
    const detectionId = await lowRiskDetection();
    const enabled = config.AUTO_REAL_ENABLED;
    try {
      if (condition === 'disabled') config.AUTO_REAL_ENABLED = false;
      if (condition === 'held' || condition === 'deleted') {
        await getTestPool().query('UPDATE posts SET status = $1 WHERE id = $2', [
          condition,
          postId,
        ]);
      }
      if (condition === 'recent')
        await getTestPool().query('UPDATE posts SET created_at = now() WHERE id = $1', [postId]);
      if (condition === 'suspended')
        await getTestPool().query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [
          authorId,
        ]);
      if (condition === 'deleted-author')
        await getTestPool().query(
          `UPDATE users SET status = 'deleted', deleted_at = now() WHERE id = $1`,
          [authorId],
        );
      if (condition === 'no-detection')
        await getTestPool().query('DELETE FROM detection_results WHERE id = $1', [detectionId]);
      if (condition === 'reshare') {
        const original = await post();
        await getTestPool().query(
          `UPDATE posts SET kind = 'reshare', reshare_of_post_id = $1 WHERE id = $2`,
          [original, postId],
        );
      }
      if (condition.includes('report')) {
        await createReport(postId, reporterId, { reason: 'other' });
        if (condition === 'resolved-report')
          await getTestPool().query(`UPDATE reports SET status = 'resolved'`);
      }
      if (condition === 'assessed')
        await assessPost(postId, adminId, { verdict: 'unverifiable', rationale });
      if (condition === 'old-assessment') {
        await assessPost(postId, adminId, { verdict: 'unverifiable', rationale });
        await getTestPool().query('UPDATE assessments SET is_current = false WHERE post_id = $1', [
          postId,
        ]);
      }
      if (condition === 'old-revision')
        await getTestPool().query('UPDATE posts SET revision = 2 WHERE id = $1', [postId]);
      if (condition === 'high-risk')
        await getTestPool().query('UPDATE detection_results SET p_fake = 0.9 WHERE id = $1', [
          detectionId,
        ]);
      if (condition === 'failed')
        await getTestPool().query(`UPDATE detection_results SET status = 'failed' WHERE id = $1`, [
          detectionId,
        ]);
      if (condition === 'newer-queued') {
        await getTestPool().query(
          `INSERT INTO detection_results (post_id, post_revision) VALUES ($1, 1)`,
          [postId],
        );
      }
      expect(await runAutoRealOnce()).toBe(0);
      expect(
        (await getTestPool().query(`SELECT * FROM assessments WHERE source = 'auto_real'`)).rows,
      ).toHaveLength(0);
    } finally {
      config.AUTO_REAL_ENABLED = enabled;
    }
  });

  it('auto-real rewards only the author; a later report escalates to the queue and admin supersedes it', async () => {
    await lowRiskDetection();
    const sharer = await createTestUser();
    await getTestPool().query(
      `INSERT INTO posts (author_id, kind, reshare_of_post_id, author_tier_at_post)
       VALUES ($1, 'reshare', $2, 'neutral')`,
      [sharer.id, postId],
    );
    expect(await runAutoRealOnce()).toBe(1);
    expect(await runAutoRealOnce()).toBe(0);
    const auto = await getTestPool().query(`SELECT * FROM assessments WHERE post_id = $1`, [
      postId,
    ]);
    const events = await getTestPool().query('SELECT user_id, kind FROM reputation_events');
    expect(events.rows).toEqual([{ user_id: authorId, kind: 'RESPONSIBLE_POST' }]);
    expect(
      (await request.get('/api/v1/admin/queue').set('Cookie', adminCookie)).body.items,
    ).toHaveLength(0);
    const reported = await request
      .post(`/api/v1/posts/${postId}/report`)
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', await session(reporterId))
      .send({ reason: 'false_information' });
    expect(reported.status).toBe(201);
    const queue = await request.get('/api/v1/admin/queue').set('Cookie', adminCookie);
    expect(queue.body.items[0]).toMatchObject({ post: { id: postId }, reasons: ['reported'] });
    const result = await assessPost(postId, adminId, { verdict: 'fake', rationale });
    expect(result.eventsVoided).toBe(1);
    expect(result.eventsCreated).toContainEqual({ kind: 'VALID_REPORT', count: 1 });
    expect(
      (
        await getTestPool().query('SELECT is_current FROM assessments WHERE id = $1', [
          auto.rows[0].id,
        ])
      ).rows[0].is_current,
    ).toBe(false);
  });

  it('permits auto-real to admin-real upgrade and protects good-faith interactions on overturn', async () => {
    await lowRiskDetection();
    await runAutoRealOnce();
    const result = await assessPost(postId, adminId, { verdict: 'real', rationale });
    expect(result.eventsVoided).toBe(1);
    const sharer = await createTestUser();
    await getTestPool().query(
      `INSERT INTO posts (author_id, kind, reshare_of_post_id, author_tier_at_post)
       VALUES ($1, 'reshare', $2, 'neutral')`,
      [sharer.id, postId],
    );
    await getTestPool().query('INSERT INTO likes (user_id, post_id) VALUES ($1, $2)', [
      reporterId,
      postId,
    ]);
    await assessPost(postId, adminId, { verdict: 'fake', rationale });
    const penalties = await getTestPool().query(
      `SELECT * FROM reputation_events WHERE kind IN ('MISINFO_RESHARE', 'MISINFO_LIKE')`,
    );
    expect(penalties.rows).toHaveLength(0);
  });

  it('awards existing resharers only when auto-real is upgraded to admin real', async () => {
    await lowRiskDetection();
    const sharer = await createTestUser();
    await getTestPool().query(
      `INSERT INTO posts (author_id, kind, reshare_of_post_id, author_tier_at_post)
       VALUES ($1, 'reshare', $2, 'neutral')`,
      [sharer.id, postId],
    );
    await runAutoRealOnce();
    expect(
      (
        await getTestPool().query(
          `SELECT * FROM reputation_events WHERE kind = 'RESPONSIBLE_RESHARE'`,
        )
      ).rows,
    ).toHaveLength(0);
    const result = await assessPost(postId, adminId, { verdict: 'real', rationale });
    expect(result.eventsCreated).toContainEqual({ kind: 'RESPONSIBLE_RESHARE', count: 1 });
    const reward = await getTestPool().query(
      `SELECT user_id, value, status FROM reputation_events WHERE kind = 'RESPONSIBLE_RESHARE'`,
    );
    expect(reward.rows).toEqual([{ user_id: sharer.id, value: 1, status: 'eligible' }]);
  });

  it.each(['anonymous', 'user', 'suspended'])(
    'denies assessment authority to %s callers',
    async (state) => {
      const user = await createTestUser({
        role: state === 'user' ? 'user' : 'admin',
        status: state === 'suspended' ? 'suspended' : 'active',
      });
      const call = request
        .post(`/api/v1/admin/posts/${postId}/assessments`)
        .set('Origin', config.APP_ORIGIN)
        .send({ verdict: 'fake', rationale });
      if (state !== 'anonymous') call.set('Cookie', await session(user.id));
      const response = await call;
      expect(response.status).toBe(state === 'anonymous' ? 401 : 403);
      expect((await getTestPool().query('SELECT * FROM assessments')).rows).toHaveLength(0);
    },
  );

  it('reverses counted events without changing the finalized ledger', async () => {
    const original = await assessPost(postId, adminId, { verdict: 'fake', rationale });
    await finalizeWave();
    const ledger = await getTestPool().query('SELECT * FROM user_wave_reputation ORDER BY user_id');
    const result = await assessPost(postId, adminId, { verdict: 'real', rationale });
    expect(result.reversalsCreated).toBe(1);
    expect(
      (await getTestPool().query('SELECT * FROM user_wave_reputation ORDER BY user_id')).rows,
    ).toEqual(ledger.rows);
    expect(
      (
        await getTestPool().query('SELECT status FROM reputation_events WHERE assessment_id = $1', [
          original.assessment.id,
        ])
      ).rows[0].status,
    ).toBe('counted');
  });
});
