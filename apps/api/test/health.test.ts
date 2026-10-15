/**
 * TASK-005 tests: health endpoint and error envelope.
 *
 * These tests use supertest against the real Express app but need NO database,
 * object storage or SMTP — the health endpoint has no external dependencies.
 */

import { describe, it, expect } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../src/app';

const app = createApp();
const request = supertest(app);

describe('GET /healthz', () => {
  it('returns 200 with status ok', async () => {
    const res = await request.get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toStrictEqual({ status: 'ok' });
  });
});

describe('404 handler', () => {
  it('unknown route returns NOT_FOUND error envelope', async () => {
    const res = await request.get('/api/v1/this-route-does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(typeof res.body.error.message).toBe('string');
    expect(typeof res.body.error.requestId).toBe('string');
    // requestId must look like a UUID
    expect(res.body.error.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('unknown POST route returns NOT_FOUND error envelope', async () => {
    const res = await request.post('/api/v1/nonexistent').send({});
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
