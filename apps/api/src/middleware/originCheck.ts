/**
 * apps/api/src/middleware/originCheck.ts (TASK-037, REQ-025, SEC-004)
 *
 * Enforces Origin header matches APP_ORIGIN on non-GET and non-HEAD requests.
 */

import { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';
import { AppError } from './errors.js';

export function originCheck(req: Request, _res: Response, next: NextFunction): void {
  // GET and HEAD requests are safe and do not trigger CSRF state mutations
  if (req.method === 'GET' || req.method === 'HEAD') {
    return next();
  }

  const origin = req.headers['origin'];
  if (!origin || origin !== config.APP_ORIGIN) {
    return next(new AppError(403, 'FORBIDDEN', 'Invalid or missing Origin header'));
  }

  next();
}
