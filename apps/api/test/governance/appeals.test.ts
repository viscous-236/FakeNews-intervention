/** Appeal routes, scoring consequences, and concurrent finalization on real PostgreSQL. */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../../src/app.js';
import { config } from '../../src/config.js';
import { closePool } from '../../src/db/pool.js';
import { assessPost } from '../../src/modules/governance/assessments.js';
import { appealEvent } from '../../src/modules/governance/appeals.js';
import { finalizeWave } from '../../src/scoring/finalizeWave.js';
import { notificationBus } from '../../src/modules/notifications/bus.js';
import { createTestUser } from '../setup/factories.js';
import { closeTestPool, getTestPool, truncateAll } from '../setup/db.js';

describe('Appeal lifecycle (TASK-057–058)', () => {
  const request = supertest(createApp());
  const reason = 'Please review the evidence supporting this claim again.';
  const note = 'Reviewed the evidence and recorded the final decision.';
  const rationale = 'The primary sources support the revised assessment.';
  let adminId: string;
  let adminCookie: string;
  let postId: string;
  let assessmentId: string;
  let events: { id: string; user_id: string; kind: string; cookie: string }[];

  async function session(userId: string): Promise<string> {
    const token = randomBytes(32).toString('hex');
    await getTestPool().query(
      `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 day')`,
      [userId, createHash('sha256').update(token).digest('hex')],
    );
    return `${config.SESSION_COOKIE_NAME}=${token}`;
  }

  beforeEach(async () => {
    await truncateAll();
    const admin = await createTestUser({ role: 'admin' });
    const author = await createTestUser();
    const sharer = await createTestUser();
    const liker = await createTestUser();
    adminId = admin.id;
    adminCookie = await session(adminId);
    const post = await getTestPool().query<{ id: string }>(
      `INSERT INTO posts (author_id, kind, body, author_tier_at_post)
       VALUES ($1, 'original', 'A claim disputed by its author and readers.', 'neutral') RETURNING id`,
      [author.id],
    );
    postId = post.rows[0]!.id;
    await getTestPool().query(
      `INSERT INTO posts (author_id, kind, reshare_of_post_id, author_tier_at_post)
       VALUES ($1, 'reshare', $2, 'neutral')`,
      [sharer.id, postId],
    );
    await getTestPool().query('INSERT INTO likes (user_id, post_id) VALUES ($1, $2)', [
      liker.id,
      postId,
    ]);
    assessmentId = (await assessPost(postId, adminId, { verdict: 'fake', rationale })).assessment
      .id;
    const rows = await getTestPool().query<{ id: string; user_id: string; kind: string }>(
      'SELECT id, user_id, kind FROM reputation_events ORDER BY kind',
    );
    events = await Promise.all(
      rows.rows.map(async (row) => ({ ...row, cookie: await session(row.user_id) })),
    );
  });

  afterAll(async () => {
    await closePool();
    await closeTestPool();
  });

  async function open(event = events[0]!) {
    return request
      .post(`/api/v1/events/${event.id}/appeal`)
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', event.cookie)
      .send({ reason });
  }

  async function resolve(id: string, body: object, cookie = adminCookie) {
    return request
      .post(`/api/v1/admin/appeals/${id}/resolve`)
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', cookie)
      .send(body);
  }

  it.each(['MISINFO_POST', 'MISINFO_RESHARE', 'MISINFO_LIKE'])(
    'holds an appealed %s event and publishes admin notification after commit',
    async (kind) => {
      const event = events.find((row) => row.kind === kind)!;
      const committed: Promise<number | null>[] = [];
      const listener = (item: { id: string }): void => {
        committed.push(
          getTestPool()
            .query('SELECT id FROM notifications WHERE id = $1', [item.id])
            .then((result) => result.rowCount),
        );
      };
      notificationBus.on(`notification:${adminId}`, listener);
      let response;
      try {
        response = await open(event);
      } finally {
        notificationBus.off(`notification:${adminId}`, listener);
      }
      expect(response.status).toBe(201);
      expect(await Promise.all(committed)).toEqual([1]);
      expect(
        (
          await getTestPool().query('SELECT status, wave_id FROM reputation_events WHERE id = $1', [
            event.id,
          ])
        ).rows,
      ).toEqual([{ status: 'held', wave_id: null }]);
      const mine = await request.get('/api/v1/me/appeals').set('Cookie', event.cookie);
      expect(mine.body.items).toContainEqual(
        expect.objectContaining({ id: response.body.id, status: 'open' }),
      );
      const notifications = await getTestPool().query(
        `SELECT user_id, payload FROM notifications WHERE type = 'appeal_opened'`,
      );
      expect(notifications.rows).toEqual([
        { user_id: adminId, payload: { appealId: response.body.id, eventId: event.id } },
      ]);
    },
  );

  it('upholds a held event into the current wave and audits/notifies once', async () => {
    const event = events[0]!;
    const appeal = await open(event);
    await finalizeWave();
    const response = await resolve(appeal.body.id, { decision: 'upheld', note });
    expect(response.status).toBe(200);
    const row = await getTestPool().query(
      `SELECT e.status, w.number FROM reputation_events e JOIN waves w ON w.id = e.wave_id WHERE e.id = $1`,
      [event.id],
    );
    expect(row.rows).toEqual([{ status: 'eligible', number: 2 }]);
    const audit = await getTestPool().query(
      `SELECT actor_id, after FROM admin_audit_log WHERE action = 'appeal.resolve'`,
    );
    expect(audit.rows).toEqual([
      { actor_id: adminId, after: { status: 'upheld', note, newAssessmentId: null } },
    ]);
    expect((await resolve(appeal.body.id, { decision: 'upheld', note })).status).toBe(409);
    expect(
      (await getTestPool().query(`SELECT * FROM notifications WHERE type = 'appeal_resolved'`))
        .rows,
    ).toHaveLength(1);
  });

  it.each(['real', 'unverifiable'] as const)(
    'overturns to %s, voids all pending penalties, closes peer appeals, and notifies each appellant',
    async (newVerdict) => {
      const opened = await Promise.all(events.map((event) => open(event)));
      const response = await resolve(opened[0]!.body.id, {
        decision: 'overturned',
        note,
        newVerdict,
        rationale,
      });
      expect(response.status).toBe(200);
      const successor = response.body.newAssessmentId;
      expect(
        (
          await getTestPool().query(
            'SELECT verdict, supersedes_id, is_current FROM assessments WHERE id = $1',
            [successor],
          )
        ).rows,
      ).toEqual([{ verdict: newVerdict, supersedes_id: assessmentId, is_current: true }]);
      const penalties = await getTestPool().query(
        'SELECT status, void_reason FROM reputation_events WHERE assessment_id = $1',
        [assessmentId],
      );
      expect(penalties.rows).toHaveLength(3);
      expect(
        penalties.rows.every(
          (row) => row.status === 'voided' && row.void_reason === 'assessment_superseded',
        ),
      ).toBe(true);
      const appeals = await getTestPool().query(
        'SELECT status, new_assessment_id, resolved_by, resolved_by_system FROM appeals',
      );
      expect(
        appeals.rows.every(
          (row) => row.status === 'overturned' && row.new_assessment_id === successor,
        ),
      ).toBe(true);
      expect(
        appeals.rows.filter((row) => row.resolved_by === adminId && !row.resolved_by_system),
      ).toHaveLength(1);
      const notices = await getTestPool().query(
        `SELECT user_id FROM notifications WHERE type = 'appeal_resolved'`,
      );
      expect(notices.rows.map((row) => row.user_id).sort()).toEqual(
        events.map((row) => row.user_id).sort(),
      );
    },
  );

  it.each(['upheld', 'overturned'] as const)(
    'preserves counted events and the ledger when %s',
    async (decision) => {
      await finalizeWave();
      const ledger = (
        await getTestPool().query('SELECT * FROM user_wave_reputation ORDER BY user_id')
      ).rows;
      const event = events[0]!;
      const original = (
        await getTestPool().query('SELECT * FROM reputation_events WHERE id = $1', [event.id])
      ).rows;
      const appeal = await open(event);
      const body =
        decision === 'upheld'
          ? { decision, note }
          : { decision, note, newVerdict: 'unverifiable', rationale };
      expect((await resolve(appeal.body.id, body)).status).toBe(200);
      expect(
        (await getTestPool().query('SELECT * FROM reputation_events WHERE id = $1', [event.id]))
          .rows,
      ).toEqual(original);
      expect(
        (await getTestPool().query('SELECT * FROM user_wave_reputation ORDER BY user_id')).rows,
      ).toEqual(ledger);
      const reversals = await getTestPool().query(
        `SELECT value, status FROM reputation_events WHERE kind = 'REVERSAL'`,
      );
      expect(reversals.rows).toHaveLength(decision === 'overturned' ? 3 : 0);
      expect(reversals.rows.every((row) => row.value === 1 && row.status === 'eligible')).toBe(
        true,
      );
    },
  );

  it('validates ownership, event status, IDs, reason, and overturn evidence', async () => {
    expect(
      (
        await request
          .post(`/api/v1/events/${events[0]!.id}/appeal`)
          .set('Origin', config.APP_ORIGIN)
          .set('Cookie', events[1]!.cookie)
          .send({ reason })
      ).status,
    ).toBe(404);
    expect(
      (
        await request
          .post('/api/v1/events/not-a-uuid/appeal')
          .set('Origin', config.APP_ORIGIN)
          .set('Cookie', events[0]!.cookie)
          .send({ reason })
      ).status,
    ).toBe(400);
    expect(
      (
        await request
          .post(`/api/v1/events/${events[0]!.id}/appeal`)
          .set('Origin', config.APP_ORIGIN)
          .set('Cookie', events[0]!.cookie)
          .send({ reason: ' '.repeat(25) })
      ).status,
    ).toBe(400);
    const appeal = await open();
    for (const body of [
      { decision: 'overturned', note },
      { decision: 'overturned', note, newVerdict: 'fake', rationale },
      { decision: 'overturned', note, newVerdict: 'real' },
      { decision: 'upheld', note: 'short' },
    ]) {
      expect((await resolve(appeal.body.id, body)).status).toBe(400);
    }
    expect((await resolve(randomUUID(), { decision: 'upheld', note })).status).toBe(404);
    await assessPost(postId, adminId, { verdict: 'real', rationale });
    expect((await open(events[1]!)).status).toBe(400);
    const positive = (
      await getTestPool().query(
        `SELECT id, user_id FROM reputation_events WHERE kind = 'RESPONSIBLE_POST'`,
      )
    ).rows[0];
    await expect(appealEvent(positive.user_id, positive.id, { reason })).rejects.toMatchObject({
      code: 'INVALID_APPEAL',
    });
  });

  it('rejects an expired assessment appeal using persisted historical dates', async () => {
    const event = events[0]!;
    const otherPost = (
      await getTestPool().query<{ id: string }>(
        `INSERT INTO posts (author_id, kind, body, author_tier_at_post)
       VALUES ($1, 'original', 'An older claim and its historic assessment.', 'neutral') RETURNING id`,
        [event.user_id],
      )
    ).rows[0]!;
    const assessment = (
      await getTestPool().query<{ id: string }>(
        `INSERT INTO assessments (post_id, post_revision, verdict, source, decided_by, rationale, created_at)
       VALUES ($1, 1, 'fake', 'admin', $2, $3, now() - ($4 || ' days')::interval) RETURNING id`,
        [otherPost.id, adminId, rationale, String(config.APPEAL_WINDOW_DAYS + 1)],
      )
    ).rows[0]!;
    const negative = (
      await getTestPool().query<{ id: string }>(
        `INSERT INTO reputation_events (user_id, post_id, assessment_id, kind, value, status, wave_id)
       SELECT $1, $2, $3, 'MISINFO_POST', -1, 'eligible', id FROM waves WHERE status = 'open' RETURNING id`,
        [event.user_id, otherPost.id, assessment.id],
      )
    ).rows[0]!;
    await expect(appealEvent(event.user_id, negative.id, { reason })).rejects.toMatchObject({
      code: 'APPEAL_WINDOW_EXPIRED',
    });
  });

  it.each(['author', 'resharer', 'liker', 'reporter'])(
    'blocks appeal resolution for an administrator with a %s conflict',
    async (kind) => {
      const kinds: Record<string, string> = {
        author: 'MISINFO_POST',
        resharer: 'MISINFO_RESHARE',
        liker: 'MISINFO_LIKE',
      };
      let userId = events.find((event) => event.kind === kinds[kind])?.user_id;
      if (!userId) {
        userId = (await createTestUser()).id;
        await getTestPool().query(
          `INSERT INTO reports (post_id, reporter_id, reason) VALUES ($1, $2, 'other')`,
          [postId, userId],
        );
      }
      await getTestPool().query(`UPDATE users SET role = 'admin' WHERE id = $1`, [userId]);
      const appeal = await open();
      const response = await resolve(
        appeal.body.id,
        { decision: 'upheld', note },
        await session(userId),
      );
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('CONFLICT_OF_INTEREST');
      expect(
        (await getTestPool().query('SELECT status FROM appeals WHERE id = $1', [appeal.body.id]))
          .rows[0].status,
      ).toBe('open');
    },
  );

  it('restricts admin routes and pages/filters appeals without losing equal-timestamp rows', async () => {
    expect((await request.get('/api/v1/admin/appeals')).status).toBe(401);
    expect(
      (await request.get('/api/v1/admin/appeals').set('Cookie', events[0]!.cookie)).status,
    ).toBe(403);
    const opened = await Promise.all(events.map((event) => open(event)));
    expect(
      (await resolve(opened[0]!.body.id, { decision: 'upheld', note }, events[0]!.cookie)).status,
    ).toBe(403);
    await getTestPool().query(`UPDATE appeals SET created_at = '2026-11-03T12:00:00.123456Z'`);
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await request
        .get('/api/v1/admin/appeals')
        .set('Cookie', adminCookie)
        .query({ limit: 1, status: 'open', ...(cursor ? { cursor } : {}) });
      expect(page.status).toBe(200);
      ids.push(...page.body.items.map((item: { id: string }) => item.id));
      cursor = page.body.nextCursor;
      expect(ids.length).toBeLessThanOrEqual(3);
    } while (cursor);
    expect(ids.sort()).toEqual(opened.map((response) => response.body.id).sort());
    await resolve(ids[0]!, { decision: 'upheld', note });
    const filtered = await request
      .get('/api/v1/admin/appeals?status=upheld')
      .set('Cookie', adminCookie);
    expect(filtered.body.items.map((item: { id: string }) => item.id)).toEqual([ids[0]]);
    expect(
      (await request.get('/api/v1/admin/appeals?cursor=invalid').set('Cookie', adminCookie)).status,
    ).toBe(400);
  });

  it('serializes duplicate opening and resolution requests', async () => {
    const opened = await Promise.all([open(), open()]);
    expect(opened.map((response) => response.status).sort()).toEqual([201, 409]);
    const appeal = opened.find((response) => response.status === 201)!;
    const resolved = await Promise.all([
      resolve(appeal.body.id, { decision: 'upheld', note }),
      resolve(appeal.body.id, {
        decision: 'overturned',
        note,
        newVerdict: 'unverifiable',
        rationale,
      }),
    ]);
    expect(resolved.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(
      (await getTestPool().query(`SELECT * FROM admin_audit_log WHERE action = 'appeal.resolve'`))
        .rows,
    ).toHaveLength(1);
  });

  it('never notifies an administrator about their own appeal', async () => {
    await getTestPool().query(`UPDATE users SET role = 'admin' WHERE id = $1`, [
      events[0]!.user_id,
    ]);
    expect((await open()).status).toBe(201);
    const recipients = await getTestPool().query(
      `SELECT user_id FROM notifications WHERE type = 'appeal_opened'`,
    );
    expect(recipients.rows).toEqual([{ user_id: adminId }]);
  });

  it('publishes appeal resolution only after its database transaction commits', async () => {
    const appeal = await open();
    const committed: Promise<string>[] = [];
    const listener = (item: { type: string }): void => {
      if (item.type !== 'appeal_resolved') return;
      committed.push(
        getTestPool()
          .query('SELECT status FROM appeals WHERE id = $1', [appeal.body.id])
          .then((result) => result.rows[0].status),
      );
    };
    notificationBus.on(`notification:${events[0]!.user_id}`, listener);
    try {
      expect((await resolve(appeal.body.id, { decision: 'upheld', note })).status).toBe(200);
    } finally {
      notificationBus.off(`notification:${events[0]!.user_id}`, listener);
    }
    expect(await Promise.all(committed)).toEqual(['upheld']);
  });

  it('opens safely across a concurrent wave rollover without modifying the counted event', async () => {
    const tx = await getTestPool().connect();
    let opening: ReturnType<typeof appealEvent> | undefined;
    try {
      await tx.query('BEGIN');
      await tx.query(`SELECT id FROM waves WHERE status = 'open' FOR UPDATE`);
      const pid = (await tx.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
      opening = appealEvent(events[0]!.user_id, events[0]!.id, { reason });
      // Wait for PostgreSQL to confirm the appeal is blocked on our wave lock.
      let blocked = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const locks = await getTestPool().query<{ blocked: boolean }>(
          'SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))) AS blocked',
          [pid],
        );
        if (locks.rows[0]?.blocked) {
          blocked = true;
          break;
        }
        await delay(10);
      }
      expect(blocked).toBe(true);
      await finalizeWave(undefined, { kind: 'system' }, tx);
      await tx.query('COMMIT');
      expect((await opening).status).toBe('open');
      expect(
        (
          await getTestPool().query('SELECT status FROM reputation_events WHERE id = $1', [
            events[0]!.id,
          ])
        ).rows,
      ).toEqual([{ status: 'counted' }]);
    } finally {
      await tx.query('ROLLBACK');
      tx.release();
      await opening?.catch(() => undefined);
    }
  });
});
