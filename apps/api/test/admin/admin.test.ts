/** Administrator inventory, moderation, wave, and verification endpoints. */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../../src/app.js';
import { config } from '../../src/config.js';
import { closePool } from '../../src/db/pool.js';
import { closeTestPool, getTestPool, truncateAll } from '../setup/db.js';
import { createTestUser } from '../setup/factories.js';

describe('Administrator operations (TASK-059)', () => {
  const request = supertest(createApp());
  let admin: { id: string };
  let adminCookie: string;

  async function session(userId: string): Promise<string> {
    const token = randomBytes(32).toString('hex');
    await getTestPool().query(
      `INSERT INTO sessions (user_id, token_hash, expires_at)
       VALUES ($1, $2, now() + interval '1 day')`,
      [userId, createHash('sha256').update(token).digest('hex')],
    );
    return `${config.SESSION_COOKIE_NAME}=${token}`;
  }

  beforeEach(async () => {
    await truncateAll();
    admin = await createTestUser({ role: 'admin' });
    adminCookie = await session(admin.id);
  });

  afterAll(async () => {
    await closePool();
    await closeTestPool();
  });

  it('rejects non-admin access across inventory and score controls', async () => {
    const user = await createTestUser();
    const cookie = await session(user.id);
    for (const path of ['/api/v1/admin/users', '/api/v1/admin/audit', '/api/v1/admin/waves']) {
      expect((await request.get(path).set('Cookie', cookie)).status).toBe(403);
    }
    expect(
      (
        await request
          .post('/api/v1/admin/verify-scores')
          .set('Origin', config.APP_ORIGIN)
          .set('Cookie', cookie)
      ).status,
    ).toBe(403);
  });

  it('lists users with filters and stable cursor pagination, and returns admin detail', async () => {
    const first = await createTestUser({ username: 'alpha_admin_test' });
    await createTestUser({ username: 'beta_admin_test', status: 'suspended' });
    const filtered = await request
      .get('/api/v1/admin/users?q=alpha_admin_test')
      .set('Cookie', adminCookie);
    expect(filtered.status).toBe(200);
    expect(filtered.body.items).toHaveLength(1);
    expect(filtered.body.items[0]).toMatchObject({
      id: first.id,
      username: 'alpha_admin_test',
    });
    expect(filtered.body.items[0].password_hash).toBeUndefined();
    const page = await request.get('/api/v1/admin/users?limit=1').set('Cookie', adminCookie);
    expect(page.body.items).toHaveLength(1);
    expect(page.body.nextCursor).toBeTruthy();
    const next = await request
      .get(`/api/v1/admin/users?limit=10&cursor=${encodeURIComponent(page.body.nextCursor)}`)
      .set('Cookie', adminCookie);
    expect(next.status).toBe(200);
    expect(next.body.items.some((item: { id: string }) => item.id === page.body.items[0].id)).toBe(
      false,
    );
    expect(
      (await request.get(`/api/v1/admin/users/${first.id}`).set('Cookie', adminCookie)).body,
    ).toMatchObject({ user: { id: first.id, username: 'alpha_admin_test' }, counts: { posts: 0 } });
    expect(
      (await request.get('/api/v1/admin/users/not-a-uuid').set('Cookie', adminCookie)).status,
    ).toBe(400);
  });

  it('suspends users, revokes sessions, audits the action, and unsuspends them', async () => {
    const target = await createTestUser();
    const targetCookie = await session(target.id);
    expect(
      (
        await request
          .post(`/api/v1/admin/users/${target.id}/suspend`)
          .set('Origin', config.APP_ORIGIN)
          .set('Cookie', adminCookie)
      ).status,
    ).toBe(204);
    expect((await request.get('/api/v1/auth/me').set('Cookie', targetCookie)).status).toBe(401);
    expect(
      (await getTestPool().query('SELECT status FROM users WHERE id = $1', [target.id])).rows[0]
        .status,
    ).toBe('suspended');
    expect(
      (
        await request
          .post(`/api/v1/admin/users/${target.id}/unsuspend`)
          .set('Origin', config.APP_ORIGIN)
          .set('Cookie', adminCookie)
      ).status,
    ).toBe(204);
    const audit = await getTestPool().query(
      `SELECT action, after FROM admin_audit_log WHERE entity_id = $1 ORDER BY created_at`,
      [target.id],
    );
    expect(audit.rows).toEqual([
      { action: 'user.suspend', after: { status: 'suspended' } },
      { action: 'user.unsuspend', after: { status: 'active' } },
    ]);
  });

  it('soft-deletes posts, retracts an unfinalized reshare event, and audits deletion', async () => {
    const author = await createTestUser();
    const original = (
      await getTestPool().query<{ id: string }>(
        `INSERT INTO posts (author_id, kind, body, author_tier_at_post)
       VALUES ($1, 'original', 'An original post for administrator deletion.', 'neutral') RETURNING id`,
        [author.id],
      )
    ).rows[0]!;
    const reshare = (
      await getTestPool().query<{ id: string }>(
        `INSERT INTO posts (author_id, kind, reshare_of_post_id, author_tier_at_post)
       VALUES ($1, 'reshare', $2, 'neutral') RETURNING id`,
        [author.id, original.id],
      )
    ).rows[0]!;
    const assessment = (
      await getTestPool().query<{ id: string }>(
        `INSERT INTO assessments (post_id, post_revision, verdict, source, decided_by, rationale)
       VALUES ($1, 1, 'fake', 'admin', $2, 'Administrator deletion test rationale.') RETURNING id`,
        [original.id, admin.id],
      )
    ).rows[0]!;
    const event = (
      await getTestPool().query<{ id: string }>(
        `INSERT INTO reputation_events (user_id, post_id, assessment_id, reshare_post_id, kind, value, status, wave_id)
       SELECT $1, $2, $3, $4, 'MISINFO_RESHARE', -1, 'eligible', id FROM waves WHERE status = 'open' RETURNING id`,
        [author.id, original.id, assessment.id, reshare.id],
      )
    ).rows[0]!;
    expect(
      (
        await request
          .delete(`/api/v1/admin/posts/${reshare.id}`)
          .set('Origin', config.APP_ORIGIN)
          .set('Cookie', adminCookie)
      ).status,
    ).toBe(204);
    expect(
      (
        await getTestPool().query('SELECT status, deleted_at FROM posts WHERE id = $1', [
          reshare.id,
        ])
      ).rows[0].status,
    ).toBe('deleted');
    expect(
      (
        await getTestPool().query(
          'SELECT status, void_reason, wave_id FROM reputation_events WHERE id = $1',
          [event.id],
        )
      ).rows[0],
    ).toMatchObject({ status: 'voided', void_reason: 'interaction_retracted', wave_id: null });
    expect(
      (
        await getTestPool().query(`SELECT action FROM admin_audit_log WHERE entity_id = $1`, [
          reshare.id,
        ])
      ).rows,
    ).toEqual([{ action: 'post.delete' }]);
    expect(
      (
        await request
          .delete(`/api/v1/admin/posts/${reshare.id}`)
          .set('Origin', config.APP_ORIGIN)
          .set('Cookie', adminCookie)
      ).status,
    ).toBe(404);
    expect(
      (await request
        .delete('/api/v1/admin/posts/not-a-uuid')
        .set('Origin', config.APP_ORIGIN)
        .set('Cookie', adminCookie)).status,
    ).toBe(400);
  });

  it('lists waves and ledgers, finalizes an open wave, and records score verification', async () => {
    const wave = (
      await getTestPool().query<{ id: string }>(`SELECT id FROM waves WHERE status = 'open'`)
    ).rows[0]!;
    const waves = await request.get('/api/v1/admin/waves').set('Cookie', adminCookie);
    expect(waves.status).toBe(200);
    expect(waves.body.items[0]).toMatchObject({ id: wave.id, status: 'open' });
    expect(
      (await request.get(`/api/v1/admin/waves/${wave.id}/ledger`).set('Cookie', adminCookie))
        .status,
    ).toBe(200);
    const finalized = await request
      .post(`/api/v1/admin/waves/${wave.id}/finalize`)
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', adminCookie);
    expect(finalized.status).toBe(200);
    expect(finalized.body.wave).toMatchObject({ id: wave.id, status: 'finalized' });
    expect(
      (
        await request
          .post(`/api/v1/admin/waves/${wave.id}/finalize`)
          .set('Origin', config.APP_ORIGIN)
          .set('Cookie', adminCookie)
      ).status,
    ).toBe(200);
    const verification = await request
      .post('/api/v1/admin/verify-scores')
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', adminCookie);
    expect(verification.status).toBe(200);
    expect(verification.body).toMatchObject({ ok: true, issues: [] });
    expect(
      (
        await getTestPool().query(
          `SELECT action FROM admin_audit_log WHERE action IN ('wave.finalize', 'scores.verify')`,
        )
      ).rows,
    ).toEqual(expect.arrayContaining([{ action: 'wave.finalize' }, { action: 'scores.verify' }]));
  });

  it('keeps audit rows append-only and rejects unknown cursor or IDs', async () => {
    expect(
      (await request.get('/api/v1/admin/audit?cursor=bad').set('Cookie', adminCookie)).status,
    ).toBe(400);
    expect(
      (await request.get(`/api/v1/admin/waves/${randomUUID()}/ledger`).set('Cookie', adminCookie))
        .status,
    ).toBe(404);
    const audit = await request.get('/api/v1/admin/audit?limit=1').set('Cookie', adminCookie);
    expect(audit.status).toBe(200);
    const id = audit.body.items[0]?.id;
    if (id) {
      await expect(
        getTestPool().query('DELETE FROM admin_audit_log WHERE id = $1', [id]),
      ).rejects.toMatchObject({ code: 'P0001' });
    }
  });
});
