/**
 * apps/api/src/modules/feed/routes.ts (TASK-044, Section 1.7, RUL-031)
 *
 * Feed endpoints: GET /feed/global and GET /feed/following.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { listPostsQuerySchema } from '@app/shared';
import { getGlobalFeed, getFollowingFeed } from './service.js';

export const feedRouter = Router();

// GET /feed/global (Public, with optional viewer for block filtering / viewer state)
feedRouter.get(
  '/feed/global',
  authenticate,
  validate({ query: listPostsQuerySchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const viewer = req.user
        ? { id: req.user.id, role: req.user.role }
        : undefined;
      const query = req.query as unknown as { cursor?: string; limit?: number };
      const limit = query.limit ?? 20;

      const result = await getGlobalFeed(
        { cursor: query.cursor, limit },
        viewer,
      );

      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);

// GET /feed/following (Authenticated)
feedRouter.get(
  '/feed/following',
  requireAuth,
  validate({ query: listPostsQuerySchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const viewer = { id: req.user!.id, role: req.user!.role };
      const query = req.query as unknown as { cursor?: string; limit?: number };
      const limit = query.limit ?? 20;

      const result = await getFollowingFeed(
        { cursor: query.cursor, limit },
        viewer,
      );

      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);
