/**
 * apps/api/test/middleware/originCheck.test.ts (TASK-037)
 */

import { describe, it, expect } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import { originCheck } from '../../src/middleware/originCheck.js';
import { errorHandler } from '../../src/middleware/errors.js';

function createOriginTestApp() {
  const app = express();
  app.use(originCheck);
  app.get('/test', (_req, res) => res.json({ ok: true }));
  app.head('/test', (_req, res) => res.status(200).end());
  app.post('/test', (_req, res) => res.json({ ok: true }));
  app.put('/test', (_req, res) => res.json({ ok: true }));
  app.delete('/test', (_req, res) => res.json({ ok: true }));
  app.use(errorHandler);
  return app;
}

describe('originCheck middleware (REQ-025)', () => {
  const request = supertest(createOriginTestApp());

  it('allows GET requests without Origin header', async () => {
    const res = await request.get('/test');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('allows HEAD requests without Origin header', async () => {
    const res = await request.head('/test');
    expect(res.status).toBe(200);
  });

  it('blocks POST requests without Origin header with 403 FORBIDDEN', async () => {
    const res = await request.post('/test');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(res.body.error.message).toMatch(/Origin/i);
  });

  it('blocks POST requests with incorrect Origin header with 403 FORBIDDEN', async () => {
    const res = await request.post('/test').set('Origin', 'https://evil.com');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('allows POST requests with exact APP_ORIGIN', async () => {
    const res = await request.post('/test').set('Origin', 'http://localhost:5173');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('blocks PUT and DELETE requests without Origin header', async () => {
    const putRes = await request.put('/test');
    expect(putRes.status).toBe(403);
    const delRes = await request.delete('/test');
    expect(delRes.status).toBe(403);
  });
});
