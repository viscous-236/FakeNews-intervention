/**
 * apps/api/test/modules/posts/posts.test.ts (TASK-043)
 *
 * Tests for Post module endpoints:
 *   - POST /posts (creation, detection queue, media attachment, low-tier hold)
 *   - GET /posts/:id (public visibility, authorView, adminView, like counts)
 *   - PATCH /posts/:id (edit window, revisioning, detection re-queue, block on assessment)
 *   - DELETE /posts/:id (soft delete, permission check, reshare retraction)
 *   - GET /users/:username/posts (keyset cursor pagination, held post privacy)
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

describe('Posts Module (TASK-043)', () => {
  const app = createApp();
  const request = supertest(app);

  beforeAll(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await closeTestPool();
  });

  it('POST /posts: rejects unauthenticated caller', async () => {
    // 1. Unauthenticated
    const resNoAuth = await request
      .post('/api/v1/posts')
      .set('Origin', config.APP_ORIGIN)
      .set('X-Forwarded-For', '10.0.1.1')
      .send({ body: 'Hello world unauth' });
    expect(resNoAuth.status).toBe(401);
  });

  it('POST /posts: creates original post, queues detection, returns 201 PostOutput', async () => {
    const author = await createUser({
      username: 'author_original',
      email: 'author_original@example.com',
      password: 'password123',
      displayName: 'Original Author',
    });

    const loginRes = await request
      .post('/api/v1/auth/login')
      .set('Origin', config.APP_ORIGIN)
      .set('X-Forwarded-For', '10.0.2.1')
      .send({
        identifier: author.email,
        password: 'password123',
      });
    const authorCookie = extractCookie(loginRes.headers);

    const res = await request
      .post('/api/v1/posts')
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', authorCookie)
      .set('X-Forwarded-For', '10.0.2.2')
      .send({
        body: 'First announcement for the platform! https://example.com/source',
        sourceUrl: 'https://example.com/source',
      });

    expect(res.status).toBe(201);
    const post = res.body;
    expect(post.id).toBeDefined();
    expect(post.kind).toBe('original');
    expect(post.author.username).toBe('author_original');
    expect(post.body).toBe('First announcement for the platform! https://example.com/source');
    expect(post.sourceUrl).toBe('https://example.com/source');
    expect(post.status).toBe('published');
    expect(post.counts).toEqual({ likes: 0, comments: 0, reshares: 0 });
    expect(post.authorView).toBeDefined();
    expect(post.authorView.detection.status).toBe('queued');

    // Verify detection row inserted in DB
    const pool = getTestPool();
    const detRow = await pool.query(
      `SELECT * FROM detection_results WHERE post_id = $1 AND post_revision = 1`,
      [post.id],
    );
    expect(detRow.rows.length).toBe(1);
    expect(detRow.rows[0]!.status).toBe('queued');
  });

  it('POST /posts: attaches media images and enforces 4 images max', async () => {
    const author = await createUser({
      username: 'author_media_poster',
      email: 'author_media@example.com',
      password: 'password123',
      displayName: 'Media Author',
    });

    const pool = getTestPool();
    // Seed 5 media rows in DB
    const mediaIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const ins = await pool.query<{ id: string }>(
        `INSERT INTO media (owner_id, kind, object_key, content_type, bytes, width, height)
         VALUES ($1, 'post_image', $2, 'image/webp', 1024, 800, 600) RETURNING id`,
        [author.id, `media_key_${i}_${Date.now()}`],
      );
      mediaIds.push(ins.rows[0]!.id);
    }

    const loginRes = await request
      .post('/api/v1/auth/login')
      .set('Origin', config.APP_ORIGIN)
      .set('X-Forwarded-For', '10.0.3.1')
      .send({
        identifier: author.email,
        password: 'password123',
      });
    const authorCookie = extractCookie(loginRes.headers);

    // Exceeding 4 images -> 400 validation error
    const failRes = await request
      .post('/api/v1/posts')
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', authorCookie)
      .set('X-Forwarded-For', '10.0.3.2')
      .send({
        body: 'Too many images',
        mediaIds,
      });
    expect(failRes.status).toBe(400);

    // 2 images -> 201 OK
    const okRes = await request
      .post('/api/v1/posts')
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', authorCookie)
      .set('X-Forwarded-For', '10.0.3.3')
      .send({
        body: 'Post with 2 images attached here for length',
        mediaIds: mediaIds.slice(0, 2),
      });
    expect(okRes.status).toBe(201);
    expect(okRes.body.images).toHaveLength(2);
    expect(okRes.body.images[0].url).toContain(mediaIds[0]);
  });

  it('POST /posts: RUL-024 holds posts by low-tier authors when HOLD_LOW_TIER_POSTS=true', async () => {
    const originalSetting = config.HOLD_LOW_TIER_POSTS;
    (config as unknown as { HOLD_LOW_TIER_POSTS: boolean }).HOLD_LOW_TIER_POSTS = true;

    try {
      const lowUser = await createUser({
        username: 'low_tier_author',
        email: 'low_tier@example.com',
        password: 'password123',
        displayName: 'Low Tier Author',
      });

      const pool = getTestPool();
      // Set q to -3.000 (low tier)
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SET LOCAL app.scoring = 'on'");
        await client.query(`UPDATE users SET q = '-3.000' WHERE id = $1`, [lowUser.id]);
        await client.query('COMMIT');
      } finally {
        client.release();
      }

      const loginRes = await request
        .post('/api/v1/auth/login')
        .set('Origin', config.APP_ORIGIN)
        .set('X-Forwarded-For', '10.0.4.1')
        .send({
          identifier: lowUser.email,
          password: 'password123',
        });
      const lowCookie = extractCookie(loginRes.headers);

      const postRes = await request
        .post('/api/v1/posts')
        .set('Origin', config.APP_ORIGIN)
        .set('Cookie', lowCookie)
        .set('X-Forwarded-For', '10.0.4.2')
        .send({ body: 'Low tier post content long enough' });

      expect(postRes.status).toBe(201);
      expect(postRes.body.status).toBe('held');
      const postId = postRes.body.id;

      // Public / anonymous gets 404
      const pubGet = await request
        .get(`/api/v1/posts/${postId}`)
        .set('X-Forwarded-For', '10.0.4.3');
      expect(pubGet.status).toBe(404);

      // Author gets post with status 'held'
      const authorGet = await request
        .get(`/api/v1/posts/${postId}`)
        .set('Cookie', lowCookie)
        .set('X-Forwarded-For', '10.0.4.4');
      expect(authorGet.status).toBe(200);
      expect(authorGet.body.status).toBe('held');
    } finally {
      (config as unknown as { HOLD_LOW_TIER_POSTS: boolean }).HOLD_LOW_TIER_POSTS = originalSetting;
    }
  });

  it('GET /posts/:id: authorView, adminView, and active likes count', async () => {
    const author = await createUser({
      username: 'view_author',
      email: 'view_author@example.com',
      password: 'password123',
      displayName: 'View Author',
    });

    const admin = await createUser({
      username: 'view_admin',
      email: 'view_admin@example.com',
      password: 'password123',
      displayName: 'View Admin',
      role: 'admin',
    });

    const reader = await createUser({
      username: 'view_reader',
      email: 'view_reader@example.com',
      password: 'password123',
      displayName: 'View Reader',
    });

    const pool = getTestPool();
    // Insert post
    const postIns = await pool.query<{ id: string }>(
      `INSERT INTO posts (author_id, kind, body, status, author_tier_at_post)
       VALUES ($1, 'original', 'Visible post for views test', 'published', 'neutral')
       RETURNING id`,
      [author.id],
    );
    const postId = postIns.rows[0]!.id;

    // Insert 1 active like and 1 soft-deleted like
    await pool.query(
      `INSERT INTO likes (user_id, post_id, created_at, deleted_at)
       VALUES ($1, $2, now(), NULL)`,
      [reader.id, postId],
    );
    await pool.query(
      `INSERT INTO likes (user_id, post_id, created_at, deleted_at)
       VALUES ($1, $2, now() - INTERVAL '1 hour', now())`,
      [admin.id, postId],
    );

    // 1. Reader view (public user): counts.likes = 1, no authorView, no adminView
    const readerLogin = await request
      .post('/api/v1/auth/login')
      .set('Origin', config.APP_ORIGIN)
      .set('X-Forwarded-For', '10.0.5.1')
      .send({ identifier: reader.email, password: 'password123' });
    const readerCookie = extractCookie(readerLogin.headers);

    const readerGet = await request
      .get(`/api/v1/posts/${postId}`)
      .set('Cookie', readerCookie)
      .set('X-Forwarded-For', '10.0.5.2');
    expect(readerGet.status).toBe(200);
    expect(readerGet.body.counts.likes).toBe(1);
    expect(readerGet.body.viewer.liked).toBe(true);
    expect(readerGet.body.authorView).toBeUndefined();
    expect(readerGet.body.adminView).toBeUndefined();

    // 2. Author view: includes authorView
    const authorLogin = await request
      .post('/api/v1/auth/login')
      .set('Origin', config.APP_ORIGIN)
      .set('X-Forwarded-For', '10.0.5.3')
      .send({ identifier: author.email, password: 'password123' });
    const authorCookie = extractCookie(authorLogin.headers);

    const authorGet = await request
      .get(`/api/v1/posts/${postId}`)
      .set('Cookie', authorCookie)
      .set('X-Forwarded-For', '10.0.5.4');
    expect(authorGet.status).toBe(200);
    expect(authorGet.body.authorView).toBeDefined();
    expect(authorGet.body.adminView).toBeUndefined();

    // 3. Admin view: includes both authorView and adminView
    const adminLogin = await request
      .post('/api/v1/auth/login')
      .set('Origin', config.APP_ORIGIN)
      .set('X-Forwarded-For', '10.0.5.5')
      .send({ identifier: admin.email, password: 'password123' });
    const adminCookie = extractCookie(adminLogin.headers);

    const adminGet = await request
      .get(`/api/v1/posts/${postId}`)
      .set('Cookie', adminCookie)
      .set('X-Forwarded-For', '10.0.5.6');
    expect(adminGet.status).toBe(200);
    expect(adminGet.body.authorView).toBeDefined();
    expect(adminGet.body.adminView).toBeDefined();
  });

  it('PATCH /posts/:id: allows edits within window, increments revision, saves post_revisions', async () => {
    const author = await createUser({
      username: 'editor_user',
      email: 'editor@example.com',
      password: 'password123',
      displayName: 'Editor User',
    });

    const loginRes = await request
      .post('/api/v1/auth/login')
      .set('Origin', config.APP_ORIGIN)
      .set('X-Forwarded-For', '10.0.6.1')
      .send({ identifier: author.email, password: 'password123' });
    const authorCookie = extractCookie(loginRes.headers);

    const createRes = await request
      .post('/api/v1/posts')
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', authorCookie)
      .set('X-Forwarded-For', '10.0.6.2')
      .send({ body: 'Initial text before edit long enough' });
    const postId = createRes.body.id;

    // Patch post
    const patchRes = await request
      .patch(`/api/v1/posts/${postId}`)
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', authorCookie)
      .set('X-Forwarded-For', '10.0.6.3')
      .send({ body: 'Updated text after revision long enough' });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.body).toBe('Updated text after revision long enough');
    expect(patchRes.body.editedAt).not.toBeNull();

    // Verify DB revisions
    const pool = getTestPool();
    const revs = await pool.query(
      `SELECT * FROM post_revisions WHERE post_id = $1 ORDER BY revision ASC`,
      [postId],
    );
    expect(revs.rows.length).toBe(1);
    expect(revs.rows[0]!.body).toBe('Initial text before edit long enough');

    // Verify detection re-queued for revision 2
    const detRow = await pool.query(
      `SELECT * FROM detection_results WHERE post_id = $1 AND post_revision = 2`,
      [postId],
    );
    expect(detRow.rows.length).toBe(1);
    expect(detRow.rows[0]!.status).toBe('queued');
  });

  it('PATCH /posts/:id: blocks edit if post is already assessed or edit window expired', async () => {
    const author = await createUser({
      username: 'blocked_editor',
      email: 'blocked_editor@example.com',
      password: 'password123',
      displayName: 'Blocked Editor',
    });

    const loginRes = await request
      .post('/api/v1/auth/login')
      .set('Origin', config.APP_ORIGIN)
      .set('X-Forwarded-For', '10.0.7.1')
      .send({ identifier: author.email, password: 'password123' });
    const authorCookie = extractCookie(loginRes.headers);

    const postRes = await request
      .post('/api/v1/posts')
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', authorCookie)
      .set('X-Forwarded-For', '10.0.7.2')
      .send({ body: 'Text to assess long enough to satisfy check' });
    const postId = postRes.body.id;

    const pool = getTestPool();
    // 1. Insert auto_real assessment for post
    await pool.query(
      `INSERT INTO assessments (post_id, post_revision, verdict, source, rationale, is_current)
       VALUES ($1, 1, 'real', 'auto_real', 'Automatic verified assessment', true)`,
      [postId],
    );

    // Try edit -> 409
    const assessedEdit = await request
      .patch(`/api/v1/posts/${postId}`)
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', authorCookie)
      .set('X-Forwarded-For', '10.0.7.3')
      .send({ body: 'Trying to edit assessed post long enough' });
    expect(assessedEdit.status).toBe(409);
    expect(assessedEdit.body.error.code).toBe('EDIT_NOT_ALLOWED');

    // 2. Window expired test on a separate post
    const postRes2 = await request
      .post('/api/v1/posts')
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', authorCookie)
      .set('X-Forwarded-For', '10.0.7.4')
      .send({ body: 'Text with expired window long enough to pass' });
    const postId2 = postRes2.body.id;

    // Set created_at to 2 hours ago
    await pool.query(`UPDATE posts SET created_at = now() - INTERVAL '2 hours' WHERE id = $1`, [
      postId2,
    ]);

    const expiredEdit = await request
      .patch(`/api/v1/posts/${postId2}`)
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', authorCookie)
      .set('X-Forwarded-For', '10.0.7.5')
      .send({ body: 'Trying to edit expired post long enough' });
    expect(expiredEdit.status).toBe(409);
    expect(expiredEdit.body.error.code).toBe('EDIT_NOT_ALLOWED');
  });

  it('DELETE /posts/:id: soft-deletes post, retrying returns 404, retracts reshare', async () => {
    const author = await createUser({
      username: 'delete_author',
      email: 'delete_author@example.com',
      password: 'password123',
      displayName: 'Delete Author',
    });

    const otherUser = await createUser({
      username: 'delete_other',
      email: 'delete_other@example.com',
      password: 'password123',
      displayName: 'Other User',
    });

    const authorLogin = await request
      .post('/api/v1/auth/login')
      .set('Origin', config.APP_ORIGIN)
      .set('X-Forwarded-For', '10.0.8.1')
      .send({ identifier: author.email, password: 'password123' });
    const authorCookie = extractCookie(authorLogin.headers);

    const otherLogin = await request
      .post('/api/v1/auth/login')
      .set('Origin', config.APP_ORIGIN)
      .set('X-Forwarded-For', '10.0.8.2')
      .send({ identifier: otherUser.email, password: 'password123' });
    const otherCookie = extractCookie(otherLogin.headers);

    const postRes = await request
      .post('/api/v1/posts')
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', authorCookie)
      .set('X-Forwarded-For', '10.0.8.3')
      .send({ body: 'Post to delete long enough to satisfy check' });
    const postId = postRes.body.id;

    // 1. Non-author trying to delete -> 403
    const forbiddenDel = await request
      .delete(`/api/v1/posts/${postId}`)
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', otherCookie)
      .set('X-Forwarded-For', '10.0.8.4');
    expect(forbiddenDel.status).toBe(403);

    // 2. Author deletes -> 204
    const okDel = await request
      .delete(`/api/v1/posts/${postId}`)
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', authorCookie)
      .set('X-Forwarded-For', '10.0.8.5');
    expect(okDel.status).toBe(204);

    // 3. GET /posts/:id for public now returns 404
    const pubGet = await request.get(`/api/v1/posts/${postId}`).set('X-Forwarded-For', '10.0.8.6');
    expect(pubGet.status).toBe(404);

    // 4. Reshare retraction test
    const pool = getTestPool();
    // Create original post
    const origIns = await pool.query<{ id: string }>(
      `INSERT INTO posts (author_id, kind, body, status, author_tier_at_post)
       VALUES ($1, 'original', 'Orig post for reshare long enough', 'published', 'neutral')
       RETURNING id`,
      [author.id],
    );
    const origId = origIns.rows[0]!.id;

    // Resharer creates reshare
    const reshareIns = await pool.query<{ id: string }>(
      `INSERT INTO posts (author_id, kind, body, status, author_tier_at_post, reshare_of_post_id)
       VALUES ($1, 'reshare', 'Reshared quote', 'published', 'neutral', $2)
       RETURNING id`,
      [otherUser.id, origId],
    );
    const reshareId = reshareIns.rows[0]!.id;

    const adminReviewer = await createUser({
      username: 'admin_rev_reshare',
      email: 'admin_rev_reshare@example.com',
      password: 'password123',
      displayName: 'Admin Reviewer',
      role: 'admin',
    });

    // Insert fake assessment on orig post and eligible reputation event on resharer
    const assessIns = await pool.query<{ id: string }>(
      `INSERT INTO assessments (post_id, post_revision, verdict, source, decided_by, rationale, is_current)
       VALUES ($1, 1, 'fake', 'admin', $2, 'Misinformation detected by admin', true) RETURNING id`,
      [origId, adminReviewer.id],
    );
    const assessId = assessIns.rows[0]!.id;

    const waveRes = await pool.query<{ id: string }>(
      `SELECT id FROM waves WHERE status = 'open' LIMIT 1`,
    );
    const waveId = waveRes.rows[0]!.id;

    await pool.query(
      `INSERT INTO reputation_events (user_id, post_id, assessment_id, kind, value, status, wave_id)
       VALUES ($1, $2, $3, 'MISINFO_RESHARE', -1, 'eligible', $4)`,
      [otherUser.id, origId, assessId, waveId],
    );

    // Resharer deletes their reshare -> triggers retraction per DEC-005
    const reshareDel = await request
      .delete(`/api/v1/posts/${reshareId}`)
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', otherCookie)
      .set('X-Forwarded-For', '10.0.8.7');
    expect(reshareDel.status).toBe(204);

    // Check event status in DB
    const evCheck = await pool.query(
      `SELECT status, void_reason FROM reputation_events WHERE user_id = $1 AND post_id = $2`,
      [otherUser.id, origId],
    );
    expect(evCheck.rows[0]!.status).toBe('voided');
    expect(evCheck.rows[0]!.void_reason).toBe('interaction_retracted');
  });

  it('GET /users/:username/posts: keyset cursor pagination works correctly', async () => {
    const user = await createUser({
      username: 'paginated_author',
      email: 'paginated@example.com',
      password: 'password123',
      displayName: 'Paginated Author',
    });

    const pool = getTestPool();
    // Create 5 posts with distinct timestamps
    for (let i = 1; i <= 5; i++) {
      await pool.query(
        `INSERT INTO posts (author_id, kind, body, status, author_tier_at_post, created_at)
         VALUES ($1, 'original', $2, 'published', 'neutral', now() - ($3 || ' minutes')::interval)`,
        [user.id, `Post #${i} long enough to satisfy original length check`, 10 - i],
      );
    }

    // Fetch page 1 (limit 2)
    const page1 = await request
      .get(`/api/v1/users/${user.username}/posts?limit=2`)
      .set('X-Forwarded-For', '10.0.9.1');
    expect(page1.status).toBe(200);
    expect(page1.body.items).toHaveLength(2);
    expect(page1.body.nextCursor).not.toBeNull();

    // Fetch page 2 (limit 2) using cursor
    const page2 = await request
      .get(
        `/api/v1/users/${user.username}/posts?limit=2&cursor=${encodeURIComponent(page1.body.nextCursor)}`,
      )
      .set('X-Forwarded-For', '10.0.9.2');
    expect(page2.status).toBe(200);
    expect(page2.body.items).toHaveLength(2);
    expect(page2.body.nextCursor).not.toBeNull();

    // Ensure page 2 items are different from page 1 items
    const page1Ids = page1.body.items.map((p: { id: string }) => p.id);
    const page2Ids = page2.body.items.map((p: { id: string }) => p.id);
    expect(page1Ids).not.toContain(page2Ids[0]);
    expect(page1Ids).not.toContain(page2Ids[1]);

    // Fetch page 3 (remaining 1)
    const page3 = await request
      .get(
        `/api/v1/users/${user.username}/posts?limit=2&cursor=${encodeURIComponent(page2.body.nextCursor)}`,
      )
      .set('X-Forwarded-For', '10.0.9.3');
    expect(page3.status).toBe(200);
    expect(page3.body.items).toHaveLength(1);
    expect(page3.body.nextCursor).toBeNull();
  });
});
