/**
 * apps/api/test/middleware/security.test.ts (TASK-037)
 */

import { describe, it, expect } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import { securityMiddleware } from '../../src/middleware/security.js';

describe('securityMiddleware (SEC-005)', () => {
  const app = express();
  app.use(securityMiddleware());
  app.get('/test', (_req, res) => res.json({ ok: true }));
  const request = supertest(app);

  it('sets standard Helmet security headers and custom CSP', async () => {
    const res = await request.get('/test');
    expect(res.status).toBe(200);

    // X-Content-Type-Options: nosniff
    expect(res.headers['x-content-type-options']).toBe('nosniff');

    // Content-Security-Policy containing specified directives
    const csp = res.headers['content-security-policy'];
    expect(csp).toBeDefined();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
  });
});
