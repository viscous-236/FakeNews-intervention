/** Phase 9 credibility analytics (TASK-070, TEST-094). */

import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../../src/app.js';
import { config } from '../../src/config.js';
import { closePool } from '../../src/db/pool.js';
import { closeTestPool, getTestPool, truncateAll } from '../setup/db.js';
import { createTestUser } from '../setup/factories.js';

describe('Credibility spread analytics (TASK-070)', () => {
  const request = supertest(createApp());
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
    const admin = await createTestUser({ role: 'admin' });
    adminCookie = await session(admin.id);
  });

  afterAll(async () => {
    await closePool();
    await closeTestPool();
  });

  it('requires admin access', async () => {
    const user = await createTestUser();
    const cookie = await session(user.id);
    const response = await request.get('/api/v1/admin/analytics/spread').set('Cookie', cookie);
    expect(response.status).toBe(403);
  });

  it('splits active reshares and likes before and after label time by tier', async () => {
    const publisher = await createTestUser({ username: 'spread_publisher' });
    const actor = await createTestUser({ username: 'spread_actor' });
    const afterActor = await createTestUser({ username: 'spread_after_actor' });
    const pool = getTestPool();

    await pool.query(`UPDATE waves SET opened_at = now() - interval '2 days' WHERE number = 1`);
    const post = await pool.query<{ id: string }>(
      `INSERT INTO posts (author_id, kind, body, status, author_tier_at_post, created_at)
       VALUES ($1, 'original', 'Spread analytics post with enough content.', 'published', 'neutral', now() - interval '2 days')
       RETURNING id`,
      [publisher.id],
    );
    const postId = post.rows[0]!.id;
    await pool.query(
      `INSERT INTO assessments
         (post_id, post_revision, verdict, source, decided_by, rationale, created_at)
       SELECT $1, 1, 'fake', 'admin', id, 'Admin label for spread analytics.', now() - interval '1 day'
         FROM users WHERE role = 'admin' LIMIT 1`,
      [postId],
    );

    await pool.query(
      `INSERT INTO posts
         (author_id, kind, reshare_of_post_id, body, status, author_tier_at_post, created_at)
       VALUES ($1, 'reshare', $2, '', 'published', 'neutral', now() - interval '36 hours')`,
      [actor.id, postId],
    );
    await pool.query(
      `INSERT INTO posts
         (author_id, kind, reshare_of_post_id, body, status, author_tier_at_post, created_at)
       VALUES ($1, 'reshare', $2, '', 'published', 'neutral', now() - interval '2 hours')`,
      [afterActor.id, postId],
    );
    await pool.query(
      `INSERT INTO likes (user_id, post_id, created_at, updated_at)
       VALUES ($1, $2, now() - interval '36 hours', now() - interval '36 hours')`,
      [actor.id, postId],
    );
    const secondLiker = await createTestUser({ username: 'spread_second_liker' });
    await pool.query(
      `INSERT INTO likes (user_id, post_id, created_at, updated_at)
       VALUES ($1, $2, now() - interval '2 hours', now() - interval '2 hours')`,
      [secondLiker.id, postId],
    );

    const response = await request
      .get('/api/v1/admin/analytics/spread')
      .set('Cookie', adminCookie);
    expect(response.status).toBe(200);
    expect(response.body.items).toEqual([
      {
        waveNumber: 1,
        authorTier: 'neutral',
        reshares: { before: 1, after: 1 },
        likes: { before: 1, after: 1 },
      },
    ]);
  });
});
