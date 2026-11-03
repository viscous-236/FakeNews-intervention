/**
 * Health module — liveness and readiness (TASK-051).
 *
 * GET /healthz   → 200 { status: 'ok' }   (no auth, liveness probe)
 */

import { Router } from 'express';
import { getReadiness } from './readiness.js';

export const healthRouter = Router();

healthRouter.get('/healthz', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

healthRouter.get('/readyz', async (_req, res, next) => {
  try {
    const state = await getReadiness();
    // Detection is asynchronous: a detector outage does not prevent serving posts.
    res.status(state.db && state.migrations ? 200 : 503).json(state);
  } catch (error) {
    next(error);
  }
});
