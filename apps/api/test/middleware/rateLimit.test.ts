/**
 * apps/api/test/middleware/rateLimit.test.ts (TASK-037)
 */

import { describe, it, expect } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import { createLimiter } from '../../src/middleware/rateLimit.js';

describe('rateLimit middleware (SEC-006)', () => {
  const app = express();
  const testLimiter = createLimiter(60 * 1000, 2, 'Test rate limit exceeded');
  app.get('/rate-test', testLimiter, (_req, res) => res.json({ ok: true }));
  const request = supertest(app);

  it('allows requests within limit and returns 429 RATE_LIMITED when exceeded', async () => {
    const res1 = await request.get('/rate-test');
    expect(res1.status).toBe(200);

    const res2 = await request.get('/rate-test');
    expect(res2.status).toBe(200);

    const res3 = await request.get('/rate-test');
    expect(res3.status).toBe(429);
    expect(res3.body.error.code).toBe('RATE_LIMITED');
    expect(res3.body.error.message).toBe('Test rate limit exceeded');
    expect(res3.headers['retry-after']).toBeDefined();
  });
});
