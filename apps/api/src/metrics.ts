/**
 * apps/api/src/metrics.ts (TASK-104)
 *
 * Prometheus metrics via prom-client at GET /metrics guarded by METRICS_TOKEN.
 */

import { Request, Response, NextFunction } from 'express';
import client from 'prom-client';
import { config } from './config.js';
import { AppError } from './middleware/appError.js';

export const register = new client.Registry();

// Default metrics (node.js, process, memory, heap, event loop)
client.collectDefaultMetrics({ register, prefix: 'app_' });

// HTTP request duration histogram
export const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

// Total HTTP requests counter
export const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests processed',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

/**
 * Normalizes route path for metric labels to prevent unbounded cardinality.
 */
function getRouteLabel(req: Request): string {
  if (req.route && typeof req.route.path === 'string') {
    const base = req.baseUrl || '';
    return `${base}${req.route.path}`;
  }
  return req.path || 'unmatched';
}

/**
 * Middleware that tracks request duration and increments counter.
 */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const end = process.hrtime.bigint();
    const durationSeconds = Number(end - start) / 1e9;
    const route = getRouteLabel(req);
    const statusCode = String(res.statusCode);
    const method = req.method;

    httpRequestsTotal.inc({ method, route, status_code: statusCode });
    httpRequestDuration.observe({ method, route, status_code: statusCode }, durationSeconds);
  });

  next();
}

/**
 * GET /metrics handler guarded by METRICS_TOKEN.
 */
export async function metricsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // Bearer token only (Section 1.7). A query-string token would leak into
    // access logs and proxies, so it is not accepted. METRICS_TOKEN is
    // mandatory in production (config.ts); when unset in development or test
    // the endpoint is open on the local machine only.
    if (config.METRICS_TOKEN) {
      const authHeader = req.headers.authorization;
      const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
      if (!bearerToken || bearerToken !== config.METRICS_TOKEN) {
        throw new AppError(401, 'UNAUTHORIZED', 'Invalid or missing metrics token');
      }
    }

    res.setHeader('Content-Type', register.contentType);
    const metricsData = await register.metrics();
    res.send(metricsData);
  } catch (error) {
    next(error);
  }
}
