/**
 * Health module — liveness endpoint only (readiness added in TASK-051).
 *
 * GET /healthz   → 200 { status: 'ok' }   (no auth, liveness probe)
 */

import { Router } from 'express';

export const healthRouter = Router();

healthRouter.get('/healthz', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});
