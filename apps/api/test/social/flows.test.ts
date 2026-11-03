/** Phase 8 social flows: follows, blocks, reshares, search, and suggestions. */

import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../../src/app.js';
import { config } from '../../src/config.js';
import { getTestPool, closeTestPool, truncateAll } from '../setup/db.js';
import { createUser } from '../../src/modules/users/service.js';
import { withTransaction } from '../../src/db/tx.js';
import { createEventsForAssessment } from '../../src/scoring/events.js';

const app = createApp();
const request = supertest(app);

function cookieFrom(headers: Record<string, unknown>): string {
  const value = headers['set-cookie'];
  return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '');
}

async function login(identifier: string, password: string, ip: string): Promise<string> {
  const response = await request
    .post('/api/v1/auth/login')
    .set('Origin', config.APP_ORIGIN)
    .set('X-Forwarded-For', ip)
    .send({ identifier, password });
  expect(response.status).toBe(200);
  return cookieFrom(response.headers);
}

async function insertPost(authorId: string, body: string): Promise<string> {
  const result = await getTestPool().query<{ id: string }>(
    `INSERT INTO posts (author_id, kind, body, status, author_tier_at_post)
     VALUES ($1, 'original', $2, 'published', 'neutral')
     RETURNING id`,
    [authorId, body],
  );
  return result.rows[0]!.id;
}

async function assessPost(
  postId: string,
  adminId: string,
  verdict: 'real' | 'fake',
): Promise<void> {
  await withTransaction(async (tx) => {
    const assessment = await tx.query<{
      id: string;
      post_id: string;
      post_revision: number;
      verdict: 'real' | 'fake' | 'unverifiable';
      source: 'admin' | 'auto_real';
      rationale: string;
    }>(
      `INSERT INTO assessments
         (post_id, post_revision, verdict, source, decided_by, rationale)
       VALUES ($1, 1, $2, 'admin', $3, $4)
       RETURNING id, post_id, post_revision, verdict, source, rationale`,
      [postId, verdict, adminId, `Admin decision: ${verdict} after review.`],
    );
    await createEventsForAssessment(tx, assessment.rows[0]!);
  });
}

describe('Social flows (TASK-061–066)', () => {
  beforeAll(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await closeTestPool();
  });

  it('follows, unfollows, blocks, and paginates connection lists', async () => {
    const user = await createUser({
      username: 'social_owner',
      email: 'social_owner@example.com',
      password: 'password12345',
      displayName: 'Social Owner',
      emailVerified: true,
    });
    const target = await createUser({
      username: 'social_target',
      email: 'social_target@example.com',
      password: 'password12345',
      displayName: 'Social Target',
      emailVerified: true,
    });
    const cookie = await login(user.email, 'password12345', '198.51.100.10');

    const follow = await request
      .post(`/api/v1/users/${target.username}/follow`)
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', cookie);
    expect(follow.status).toBe(204);

    const duplicate = await request
      .post(`/api/v1/users/${target.username}/follow`)
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', cookie);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('ALREADY_EXISTS');

    const followers = await request
      .get(`/api/v1/users/${target.username}/followers?limit=1`)
      .set('Cookie', cookie);
    expect(followers.status).toBe(200);
    expect(followers.body.items.map((item: { id: string }) => item.id)).toContain(user.id);

    const block = await request
      .post(`/api/v1/users/${target.username}/block`)
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', cookie);
    expect(block.status).toBe(204);

    const profile = await request
      .get(`/api/v1/users/${target.username}`)
      .set('Cookie', cookie);
    expect(profile.status).toBe(200);
    expect(profile.body.viewer).toEqual({ following: false, blocked: true });

    const unblock = await request
      .delete(`/api/v1/users/${target.username}/block`)
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', cookie);
    expect(unblock.status).toBe(204);

    const unfollow = await request
      .delete(`/api/v1/users/${target.username}/follow`)
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', cookie);
    expect(unfollow.status).toBe(204);
  });

  it('suggests two-hop users and fills remaining slots by follower count', async () => {
    const viewer = await createUser({
      username: 'suggest_viewer',
      email: 'suggest_viewer@example.com',
      password: 'password12345',
      displayName: 'Suggestion Viewer',
      emailVerified: true,
    });
    const mutual = await createUser({
      username: 'suggest_mutual',
      email: 'suggest_mutual@example.com',
      password: 'password12345',
      displayName: 'Suggestion Mutual',
      emailVerified: true,
    });
    const candidate = await createUser({
      username: 'suggest_candidate',
      email: 'suggest_candidate@example.com',
      password: 'password12345',
      displayName: 'Suggestion Candidate',
      emailVerified: true,
    });
    await getTestPool().query(
      `INSERT INTO follows (follower_id, followee_id) VALUES ($1, $2), ($2, $3)`,
      [viewer.id, mutual.id, candidate.id],
    );
    const cookie = await login(viewer.email, 'password12345', '198.51.100.11');

    const suggestions = await request
      .get('/api/v1/users/suggestions')
      .set('Cookie', cookie);
    expect(suggestions.status).toBe(200);
    expect(suggestions.body.items[0].id).toBe(candidate.id);
  });

  it('searches posts and users with minimum query validation', async () => {
    const author = await createUser({
      username: 'search_author',
      email: 'search_author@example.com',
      password: 'password12345',
      displayName: 'Search Author',
      emailVerified: true,
    });
    const postId = await insertPost(
      author.id,
      'Climate evidence search phrase appears in this post for indexing.',
    );

    const posts = await request.get('/api/v1/search/posts?q=climate%20evidence');
    expect(posts.status).toBe(200);
    expect(posts.body.items.map((item: { id: string }) => item.id)).toContain(postId);

    const users = await request.get('/api/v1/search/users?q=Search');
    expect(users.status).toBe(200);
    expect(users.body.items.map((item: { id: string }) => item.id)).toContain(author.id);

    const invalid = await request.get('/api/v1/search/posts?q=x');
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('creates, retracts, and reactivates fake-post reshare and like events', async () => {
    const admin = await createUser({
      username: 'social_admin',
      email: 'social_admin@example.com',
      password: 'password12345',
      displayName: 'Social Admin',
      role: 'admin',
      emailVerified: true,
    });
    const author = await createUser({
      username: 'social_publisher',
      email: 'social_publisher@example.com',
      password: 'password12345',
      displayName: 'Social Publisher',
      emailVerified: true,
    });
    const actor = await createUser({
      username: 'social_actor',
      email: 'social_actor@example.com',
      password: 'password12345',
      displayName: 'Social Actor',
      emailVerified: true,
    });
    const postId = await insertPost(
      author.id,
      'This post is used to verify social penalty lifecycle behavior.',
    );
    await assessPost(postId, admin.id, 'fake');
    const cookie = await login(actor.email, 'password12345', '198.51.100.12');

    const blocked = await request
      .post(`/api/v1/posts/${postId}/reshare`)
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', cookie)
      .send({});
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('CONFIRMATION_REQUIRED');

    const reshare = await request
      .post(`/api/v1/posts/${postId}/reshare`)
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', cookie)
      .send({ acknowledgedWarning: true });
    expect(reshare.status).toBe(201);
    const reshareId = reshare.body.id as string;

    let event = await getTestPool().query<{ status: string; void_reason: string | null }>(
      `SELECT status, void_reason FROM reputation_events
        WHERE user_id = $1 AND post_id = $2 AND kind = 'MISINFO_RESHARE'`,
      [actor.id, postId],
    );
    expect(event.rows[0]).toEqual({ status: 'eligible', void_reason: null });

    const deleteReshare = await request
      .delete(`/api/v1/posts/${reshareId}/reshare`)
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', cookie);
    expect(deleteReshare.status).toBe(204);

    event = await getTestPool().query<{ status: string; void_reason: string | null }>(
      `SELECT status, void_reason FROM reputation_events
        WHERE user_id = $1 AND post_id = $2 AND kind = 'MISINFO_RESHARE'`,
      [actor.id, postId],
    );
    expect(event.rows[0]).toEqual({ status: 'voided', void_reason: 'interaction_retracted' });

    const relike = await request
      .post(`/api/v1/posts/${postId}/like`)
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', cookie);
    expect(relike.status).toBe(204);
    const unlike = await request
      .delete(`/api/v1/posts/${postId}/like`)
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', cookie);
    expect(unlike.status).toBe(204);

    const comment = await request
      .post(`/api/v1/posts/${postId}/comments`)
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', cookie)
      .send({ body: 'Comments do not create reputation events.' });
    expect(comment.status).toBe(201);
    const commentEvents = await getTestPool().query<{ count: string }>(
      `SELECT count(*) FROM reputation_events WHERE user_id = $1 AND post_id = $2`,
      [actor.id, postId],
    );
    expect(Number(commentEvents.rows[0]!.count)).toBe(2);
  });

  it('rewards reshares of admin-verified real posts', async () => {
    const admin = await createUser({
      username: 'real_admin',
      email: 'real_admin@example.com',
      password: 'password12345',
      displayName: 'Real Admin',
      role: 'admin',
      emailVerified: true,
    });
    const author = await createUser({
      username: 'real_publisher',
      email: 'real_publisher@example.com',
      password: 'password12345',
      displayName: 'Real Publisher',
      emailVerified: true,
    });
    const actor = await createUser({
      username: 'real_actor',
      email: 'real_actor@example.com',
      password: 'password12345',
      displayName: 'Real Actor',
      emailVerified: true,
    });
    const postId = await insertPost(author.id, 'This post is used to verify responsible reshare rewards.');
    await assessPost(postId, admin.id, 'real');
    const cookie = await login(actor.email, 'password12345', '198.51.100.13');

    const reshare = await request
      .post(`/api/v1/posts/${postId}/reshare`)
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', cookie)
      .send({});
    expect(reshare.status).toBe(201);

    const event = await getTestPool().query<{ kind: string; value: number }>(
      `SELECT kind, value FROM reputation_events WHERE user_id = $1 AND post_id = $2`,
      [actor.id, postId],
    );
    expect(event.rows).toContainEqual({ kind: 'RESPONSIBLE_RESHARE', value: 1 });
  });
});
