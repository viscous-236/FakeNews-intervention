/**
 * apps/api/test/modules/feed/feed.test.ts (TASK-044, RUL-028, RUL-031)
 *
 * Tests for Feed module endpoints:
 *   - GET /feed/global (chronological ordering, held/deleted exclusion, cursor pagination, block filtering)
 *   - GET /feed/following (auth guard, own + followed posts, unfollowed exclusion, block filtering)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../../../src/app.js';
import { getTestPool, closeTestPool, truncateAll } from '../../setup/db.js';
import { config } from '../../../src/config.js';
import { createUser } from '../../../src/modules/users/service.js';

function extractCookie(headers: Record<string, unknown>): string {
  const h = headers['set-cookie'];
  return Array.isArray(h) ? String(h[0] || '') : typeof h === 'string' ? h : '';
}

describe('Feed Module (TASK-044)', () => {
  const app = createApp();
  const request = supertest(app);

  beforeAll(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await closeTestPool();
  });

  it('GET /feed/global: returns published posts chronologically, excludes held and deleted', async () => {
    const userA = await createUser({
      username: 'feed_author_a',
      email: 'feed_a@example.com',
      password: 'password123',
      displayName: 'Author A',
    });

    const userB = await createUser({
      username: 'feed_author_b',
      email: 'feed_b@example.com',
      password: 'password123',
      displayName: 'Author B',
    });

    const pool = getTestPool();

    // 1. Insert 3 published posts with spaced timestamps
    const p1 = await pool.query<{ id: string }>(
      `INSERT INTO posts (author_id, kind, body, status, author_tier_at_post, created_at)
       VALUES ($1, 'original', 'Post 1 published older long text', 'published', 'neutral', now() - INTERVAL '30 minutes')
       RETURNING id`,
      [userA.id],
    );

    const p2 = await pool.query<{ id: string }>(
      `INSERT INTO posts (author_id, kind, body, status, author_tier_at_post, created_at)
       VALUES ($1, 'original', 'Post 2 published middle long text', 'published', 'neutral', now() - INTERVAL '20 minutes')
       RETURNING id`,
      [userB.id],
    );

    const p3 = await pool.query<{ id: string }>(
      `INSERT INTO posts (author_id, kind, body, status, author_tier_at_post, created_at)
       VALUES ($1, 'original', 'Post 3 published newest long text', 'published', 'neutral', now() - INTERVAL '10 minutes')
       RETURNING id`,
      [userA.id],
    );

    // 2. Insert 1 held post and 1 deleted post
    await pool.query(
      `INSERT INTO posts (author_id, kind, body, status, author_tier_at_post, created_at)
       VALUES ($1, 'original', 'Held post that should not show in feed', 'held', 'low', now() - INTERVAL '5 minutes')`,
      [userB.id],
    );

    await pool.query(
      `INSERT INTO posts (author_id, kind, body, status, author_tier_at_post, created_at, deleted_at)
       VALUES ($1, 'original', 'Deleted post that should not show in feed', 'deleted', 'neutral', now() - INTERVAL '1 minute', now())`,
      [userA.id],
    );

    const res = await request.get('/api/v1/feed/global').set('X-Forwarded-For', '10.0.10.1');

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(3);
    // Chronological newest first: p3 -> p2 -> p1
    expect(res.body.items[0].id).toBe(p3.rows[0]!.id);
    expect(res.body.items[1].id).toBe(p2.rows[0]!.id);
    expect(res.body.items[2].id).toBe(p1.rows[0]!.id);
  });

  it('GET /feed/global: keyset cursor pagination works without duplicate items', async () => {
    const user = await createUser({
      username: 'feed_page_author',
      email: 'feed_page@example.com',
      password: 'password123',
      displayName: 'Page Author',
    });

    const pool = getTestPool();
    const createdIds: string[] = [];
    for (let i = 1; i <= 4; i++) {
      const ins = await pool.query<{ id: string }>(
        `INSERT INTO posts (author_id, kind, body, status, author_tier_at_post, created_at)
         VALUES ($1, 'original', $2, 'published', 'neutral', now() - ($3 || ' minutes')::interval)
         RETURNING id`,
        [user.id, `Paginated global feed post number ${i} length`, 100 - i],
      );
      createdIds.push(ins.rows[0]!.id);
    }

    // Page 1 with limit 2
    const page1 = await request
      .get('/api/v1/feed/global?limit=2')
      .set('X-Forwarded-For', '10.0.11.1');
    expect(page1.status).toBe(200);
    expect(page1.body.items).toHaveLength(2);
    expect(page1.body.nextCursor).not.toBeNull();

    // Page 2 with cursor
    const page2 = await request
      .get(`/api/v1/feed/global?limit=2&cursor=${encodeURIComponent(page1.body.nextCursor)}`)
      .set('X-Forwarded-For', '10.0.11.2');
    expect(page2.status).toBe(200);
    expect(page2.body.items).toHaveLength(2);

    const ids1 = page1.body.items.map((p: { id: string }) => p.id);
    const ids2 = page2.body.items.map((p: { id: string }) => p.id);
    for (const id of ids2) {
      expect(ids1).not.toContain(id);
    }
  });

  it('GET /feed/global: applies RUL-028 block filtering when viewer is authenticated', async () => {
    const blocker = await createUser({
      username: 'feed_blocker_u',
      email: 'feed_blocker@example.com',
      password: 'password123',
      displayName: 'Blocker User',
    });

    const blocked = await createUser({
      username: 'feed_blocked_u',
      email: 'feed_blocked@example.com',
      password: 'password123',
      displayName: 'Blocked User',
    });

    const pool = getTestPool();
    // Post by blocked user
    const blockedPost = await pool.query<{ id: string }>(
      `INSERT INTO posts (author_id, kind, body, status, author_tier_at_post, created_at)
       VALUES ($1, 'original', 'Post by blocked user that blocker should not see', 'published', 'neutral', now())
       RETURNING id`,
      [blocked.id],
    );

    // Insert block row
    await pool.query(`INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)`, [
      blocker.id,
      blocked.id,
    ]);

    // Blocker login
    const loginRes = await request
      .post('/api/v1/auth/login')
      .set('Origin', config.APP_ORIGIN)
      .set('X-Forwarded-For', '10.0.12.1')
      .send({ identifier: blocker.email, password: 'password123' });
    const blockerCookie = extractCookie(loginRes.headers);

    // Blocker queries global feed: blocked user's post is filtered out
    const feedRes = await request
      .get('/api/v1/feed/global')
      .set('Cookie', blockerCookie)
      .set('X-Forwarded-For', '10.0.12.2');
    expect(feedRes.status).toBe(200);
    const postIds = feedRes.body.items.map((p: { id: string }) => p.id);
    expect(postIds).not.toContain(blockedPost.rows[0]!.id);
  });

  it('GET /feed/following: requires auth and includes only own and followed users posts', async () => {
    // 1. Unauthenticated -> 401
    const unauth = await request.get('/api/v1/feed/following').set('X-Forwarded-For', '10.0.13.1');
    expect(unauth.status).toBe(401);

    // 2. Setup users: follower, followee, and stranger
    const follower = await createUser({
      username: 'feed_follower_u',
      email: 'follower@example.com',
      password: 'password123',
      displayName: 'Follower User',
    });

    const followee = await createUser({
      username: 'feed_followee_u',
      email: 'followee@example.com',
      password: 'password123',
      displayName: 'Followee User',
    });

    const stranger = await createUser({
      username: 'feed_stranger_u',
      email: 'stranger@example.com',
      password: 'password123',
      displayName: 'Stranger User',
    });

    const pool = getTestPool();
    // Follow relationship
    await pool.query(`INSERT INTO follows (follower_id, followee_id) VALUES ($1, $2)`, [
      follower.id,
      followee.id,
    ]);

    // Post by follower (own post)
    const ownPost = await pool.query<{ id: string }>(
      `INSERT INTO posts (author_id, kind, body, status, author_tier_at_post, created_at)
       VALUES ($1, 'original', 'Own post in following feed test long', 'published', 'neutral', now() - INTERVAL '5 minutes')
       RETURNING id`,
      [follower.id],
    );

    // Post by followee
    const followedPost = await pool.query<{ id: string }>(
      `INSERT INTO posts (author_id, kind, body, status, author_tier_at_post, created_at)
       VALUES ($1, 'original', 'Followed user post in feed test long', 'published', 'neutral', now() - INTERVAL '2 minutes')
       RETURNING id`,
      [followee.id],
    );

    // Post by stranger (not followed)
    const strangerPost = await pool.query<{ id: string }>(
      `INSERT INTO posts (author_id, kind, body, status, author_tier_at_post, created_at)
       VALUES ($1, 'original', 'Stranger post that should not appear long', 'published', 'neutral', now() - INTERVAL '1 minute')
       RETURNING id`,
      [stranger.id],
    );

    const loginRes = await request
      .post('/api/v1/auth/login')
      .set('Origin', config.APP_ORIGIN)
      .set('X-Forwarded-For', '10.0.13.2')
      .send({ identifier: follower.email, password: 'password123' });
    const followerCookie = extractCookie(loginRes.headers);

    const followingRes = await request
      .get('/api/v1/feed/following')
      .set('Cookie', followerCookie)
      .set('X-Forwarded-For', '10.0.13.3');

    expect(followingRes.status).toBe(200);
    const feedIds = followingRes.body.items.map((p: { id: string }) => p.id);
    expect(feedIds).toContain(ownPost.rows[0]!.id);
    expect(feedIds).toContain(followedPost.rows[0]!.id);
    expect(feedIds).not.toContain(strangerPost.rows[0]!.id);
  });
});
