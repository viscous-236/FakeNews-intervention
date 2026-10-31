/**
 * apps/api/src/modules/score/routes.ts (TASK-045, Section 1.7, RUL-016, RUL-023)
 *
 * Reputation score, ledger history, events, appeals, and wave endpoints.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, requireAuth, requireActive } from '../../middleware/auth.js';
import { appealsLimiter } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import {
  appealSchema,
  listEventsQuerySchema,
  listScoreHistoryQuerySchema,
  listAppealsQuerySchema,
} from '@app/shared';
import {
  getMyScore,
  getMyScoreHistory,
  getMyScoreHistoryByWaveNumber,
  getMyEvents,
  appealEvent,
  getMyAppeals,
  getUserScore,
  getCurrentWaveInfo,
} from './service.js';

export const scoreRouter = Router();

// GET /me/score
scoreRouter.get(
  '/me/score',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const score = await getMyScore({
        id: user.id,
        q: user.q,
        sigma: user.sigma,
      });
      res.status(200).json(score);
    } catch (err) {
      next(err);
    }
  },
);

// GET /me/score/history
scoreRouter.get(
  '/me/score/history',
  requireAuth,
  validate({ query: listScoreHistoryQuerySchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = req.query as unknown as { cursor?: string; limit?: number };
      const limit = query.limit ?? 20;
      const history = await getMyScoreHistory(req.user!.id, {
        cursor: query.cursor,
        limit,
      });
      res.status(200).json(history);
    } catch (err) {
      next(err);
    }
  },
);

// GET /me/score/history/:waveNumber
scoreRouter.get(
  '/me/score/history/:waveNumber',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const waveNumber = parseInt(req.params.waveNumber as string, 10);
      if (isNaN(waveNumber)) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid wave number',
          },
        });
        return;
      }

      const result = await getMyScoreHistoryByWaveNumber(
        req.user!.id,
        waveNumber,
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);

// GET /me/events
scoreRouter.get(
  '/me/events',
  requireAuth,
  validate({ query: listEventsQuerySchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = req.query as unknown as {
        status?: string;
        cursor?: string;
        limit?: number;
      };
      const limit = query.limit ?? 20;
      const result = await getMyEvents(req.user!.id, {
        status: query.status,
        cursor: query.cursor,
        limit,
      });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);

// POST /events/:id/appeal
scoreRouter.post(
  '/events/:id/appeal',
  requireActive,
  appealsLimiter,
  validate({ body: appealSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await appealEvent(
        req.user!.id,
        req.params.id as string,
        req.body,
      );
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

// GET /me/appeals
scoreRouter.get(
  '/me/appeals',
  requireAuth,
  validate({ query: listAppealsQuerySchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = req.query as unknown as { cursor?: string; limit?: number };
      const limit = query.limit ?? 20;
      const result = await getMyAppeals(req.user!.id, {
        cursor: query.cursor,
        limit,
      });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);

// GET /users/:username/score
scoreRouter.get(
  '/users/:username/score',
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const viewer = req.user
        ? { id: req.user.id, role: req.user.role }
        : undefined;
      const score = await getUserScore(req.params.username as string, viewer);
      res.status(200).json(score);
    } catch (err) {
      next(err);
    }
  },
);

// GET /waves/current
scoreRouter.get(
  '/waves/current',
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const wave = await getCurrentWaveInfo();
      res.status(200).json(wave);
    } catch (err) {
      next(err);
    }
  },
);
