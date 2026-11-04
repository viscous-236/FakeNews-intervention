/** Governance routes: reports, administrator assessments, and scoring effects. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../../../src/app.js';
import { config } from '../../../src/config.js';
import { createUser } from '../../../src/modules/users/service.js';
import { closeTestPool, getTestPool, truncateAll } from '../../setup/db.js';

function cookieFrom(headers: Record<string, unknown>): string {
  const value = headers['set-cookie'];
  return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '');
}

async function login(request: ReturnType<typeof supertest>, email: string, password: string) {
  const response = await request
    .post('/api/v1/auth/login')
    .set('Origin', config.APP_ORIGIN)
    .send({ identifier: email, password });
  return cookieFrom(response.headers);
}

describe('Governance module', () => {
  const request = supertest(createApp());
  let authorCookie: string;
  let reporterCookie: string;
  let adminCookie: string;
  let postId: string;

  beforeAll(async () => {
    await truncateAll();

    const author = await createUser({
      username: 'governance_author',
      email: 'governance_author@example.com',
      password: 'password123',
      displayName: 'Governance Author',
    });
    const reporter = await createUser({
      username: 'governance_reporter',
      email: 'governance_reporter@example.com',
      password: 'password123',
      displayName: 'Governance Reporter',
    });
    const admin = await createUser({
      username: 'governance_admin',
      email: 'governance_admin@example.com',
      password: 'password123',
      displayName: 'Governance Admin',
      role: 'admin',
    });

    authorCookie = await login(request, author.email, 'password123');
    reporterCookie = await login(request, reporter.email, 'password123');
    adminCookie = await login(request, admin.email, 'password123');

    const post = await request
      .post('/api/v1/posts')
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', authorCookie)
      .send({ body: 'A governance test post with enough text.' });
    expect(post.status).toBe(201);
    postId = post.body.id as string;
  });

  afterAll(async () => {
    await closeTestPool();
  });

  it('rejects a report on the caller own post', async () => {
    const response = await request
      .post(`/api/v1/posts/${postId}/report`)
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', authorCookie)
      .send({ reason: 'false_information', details: 'Own post report' });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('CONFLICT_OF_INTEREST');
  });

  it('reports a post, then admin assessment creates only permitted events', async () => {
    const report = await request
      .post(`/api/v1/posts/${postId}/report`)
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', reporterCookie)
      .send({ reason: 'false_information', details: 'The claim needs review.' });

    expect(report.status).toBe(201);
    expect(report.body.id).toEqual(expect.any(String));

    const queue = await request.get('/api/v1/admin/queue').set('Cookie', adminCookie);
    expect(queue.status).toBe(200);
    expect(queue.body.items.some((item: { post: { id: string } }) => item.post.id === postId)).toBe(
      true,
    );

    const assessment = await request
      .post(`/api/v1/admin/posts/${postId}/assessments`)
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', adminCookie)
      .send({ verdict: 'fake', rationale: 'The claim is contradicted by the cited source.' });

    expect(assessment.status).toBe(201);
    expect(assessment.body.assessment.source).toBe('admin');
    expect(assessment.body.eventsCreated).toEqual(
      expect.arrayContaining([
        { kind: 'MISINFO_POST', count: 1 },
        { kind: 'VALID_REPORT', count: 1 },
      ]),
    );

    const pool = getTestPool();
    const events = await pool.query<{ kind: string; value: number }>(
      `SELECT kind, value FROM reputation_events WHERE assessment_id = $1 ORDER BY kind`,
      [assessment.body.assessment.id],
    );
    expect(events.rows).toEqual(
      expect.arrayContaining([
        { kind: 'MISINFO_POST', value: -1 },
        { kind: 'VALID_REPORT', value: 1 },
      ]),
    );

    const reportStatus = await pool.query<{ status: string }>(
      `SELECT status FROM reports WHERE post_id = $1`,
      [postId],
    );
    expect(reportStatus.rows[0]?.status).toBe('resolved');

    const detail = await request.get(`/api/v1/admin/posts/${postId}`).set('Cookie', adminCookie);
    expect(detail.status).toBe(200);
    expect(detail.body.assessments).toHaveLength(1);
    expect(detail.body.events).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'MISINFO_POST' })]),
    );

    const like = await request
      .post(`/api/v1/posts/${postId}/like`)
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', reporterCookie);
    expect(like.status).toBe(204);

    const comment = await request
      .post(`/api/v1/posts/${postId}/comments`)
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', reporterCookie)
      .send({ body: 'This comment must not affect reputation.' });
    expect(comment.status).toBe(201);

    const likedEvent = await pool.query<{ kind: string; status: string }>(
      `SELECT kind, status FROM reputation_events
       WHERE post_id = $1 AND user_id = (SELECT reporter_id FROM reports WHERE post_id = $1)
         AND kind = 'MISINFO_LIKE'`,
      [postId],
    );
    expect(likedEvent.rows[0]).toEqual({ kind: 'MISINFO_LIKE', status: 'eligible' });

    const unlike = await request
      .delete(`/api/v1/posts/${postId}/like`)
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', reporterCookie);
    expect(unlike.status).toBe(204);

    const retractedEvent = await pool.query<{ status: string }>(
      `SELECT status FROM reputation_events
       WHERE post_id = $1 AND user_id = (SELECT reporter_id FROM reports WHERE post_id = $1)
         AND kind = 'MISINFO_LIKE'`,
      [postId],
    );
    expect(retractedEvent.rows[0]?.status).toBe('voided');
  });
});
