/** Like and comment endpoints. */

import { NextFunction, Request, Response, Router } from 'express';
import { commentSchema, listCommentsQuerySchema, reshareSchema } from '@app/shared';
import { requireActive, requireAuth } from '../../middleware/auth.js';
import { commentsLimiter, likesLimiter, resharesLimiter } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import { createComment, deleteComment, listComments } from './comments.js';
import { likePost, unlikePost } from './likes.js';
import { createReshare, deleteReshare } from './reshares.js';

export const socialRouter = Router();

socialRouter.post(
  '/posts/:id/reshare',
  requireActive,
  resharesLimiter,
  validate({ body: reshareSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const post = await createReshare(
        { id: req.user!.id, q: req.user!.q, role: req.user!.role },
        req.params.id as string,
        req.body,
      );
      res.status(201).json(post);
    } catch (error) {
      next(error);
    }
  },
);

socialRouter.delete(
  '/posts/:id/reshare',
  requireActive,
  resharesLimiter,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await deleteReshare(req.user!.id, req.params.id as string);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);

socialRouter.get(
  '/posts/:id/comments',
  validate({ query: listCommentsQuerySchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = req.query as unknown as { cursor?: string; limit?: number };
      const comments = await listComments(req.params.id as string, query.cursor, query.limit ?? 20);
      res.status(200).json(comments);
    } catch (error) {
      next(error);
    }
  },
);

socialRouter.post(
  '/posts/:id/like',
  requireActive,
  likesLimiter,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await likePost(req.user!.id, req.params.id as string);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);

socialRouter.delete(
  '/posts/:id/like',
  requireActive,
  likesLimiter,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await unlikePost(req.user!.id, req.params.id as string);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);

socialRouter.post(
  '/posts/:id/comments',
  requireActive,
  commentsLimiter,
  validate({ body: commentSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const comment = await createComment(req.user!.id, req.params.id as string, req.body.body);
      res.status(201).json(comment);
    } catch (error) {
      next(error);
    }
  },
);

socialRouter.delete(
  '/comments/:id',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await deleteComment(req.params.id as string, req.user!.id, req.user!.role === 'admin');
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);
