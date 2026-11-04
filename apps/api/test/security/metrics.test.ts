/**
 * apps/api/test/security/metrics.test.ts (TASK-104)
 *
 * Tests for Prometheus metrics and Sentry integration.
 */

import { describe, it, expect } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../../src/app.js';
import { config } from '../../src/config.js';

describe('TASK-104: Prometheus Metrics and Sentry Integration', () => {
  const app = createApp();
  const request = supertest(app);

  it('exposes Prometheus metrics at GET /metrics with process and HTTP metrics', async () => {
    // Generate a test request so metrics counter increments
    await request.get('/healthz');

    const res = await request
      .get('/metrics')
      .set('Authorization', `Bearer ${config.METRICS_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');

    const text = res.text;
    expect(text).toContain('app_');
    expect(text).toContain('http_requests_total');
    expect(text).toContain('http_request_duration_seconds');
  });

  it('enforces METRICS_TOKEN authentication when configured', async () => {
    const originalToken = config.METRICS_TOKEN;
    try {
      // Simulate configured METRICS_TOKEN
      (config as { METRICS_TOKEN?: string }).METRICS_TOKEN = 'secret-test-token-xyz';

      // 1. Without token -> 401 UNAUTHORIZED
      const resNoToken = await request.get('/metrics');
      expect(resNoToken.status).toBe(401);
      expect(resNoToken.body.error.code).toBe('UNAUTHORIZED');

      // 2. With wrong token -> 401 UNAUTHORIZED
      const resWrongToken = await request
        .get('/metrics')
        .set('Authorization', 'Bearer wrong-token');
      expect(resWrongToken.status).toBe(401);
      expect(resWrongToken.body.error.code).toBe('UNAUTHORIZED');

      // 3. With correct Bearer token -> 200 OK
      const resBearer = await request
        .get('/metrics')
        .set('Authorization', 'Bearer secret-test-token-xyz');
      expect(resBearer.status).toBe(200);
      expect(resBearer.text).toContain('http_requests_total');

      // 4. A query-string token is not an accepted credential (Section 1.7: Bearer only)
      const resQuery = await request.get('/metrics?token=secret-test-token-xyz');
      expect(resQuery.status).toBe(401);
    } finally {
      (config as { METRICS_TOKEN?: string }).METRICS_TOKEN = originalToken;
    }
  });
});
