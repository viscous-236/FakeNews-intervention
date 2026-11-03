/** Public post and user search routes (RUL-030). */

import { NextFunction, Request, Response, Router } from 'express';
import { searchQuerySchema } from '@app/shared';
import { authenticate } from '../../middleware/auth.js';
import { searchLimiter } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import { searchPosts, searchUsers } from './service.js';

export const searchRouter = Router();

searchRouter.get(
  '/search/posts',
  authenticate,
  searchLimiter,
  validate({ query: searchQuerySchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = req.query as unknown as { q: string; cursor?: string; limit: number };
      const viewer = req.user ? { id: req.user.id, role: req.user.role } : undefined;
      res.json(await searchPosts(query.q, query.cursor, query.limit, viewer));
    } catch (error) {
      next(error);
    }
  },
);

searchRouter.get(
  '/search/users',
  authenticate,
  searchLimiter,
  validate({ query: searchQuerySchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = req.query as unknown as { q: string; cursor?: string; limit: number };
      res.json(await searchUsers(query.q, query.cursor, query.limit, req.user?.id));
    } catch (error) {
      next(error);
    }
  },
);
