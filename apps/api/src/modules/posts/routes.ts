/**
 * apps/api/src/modules/posts/routes.ts (TASK-043, Section 1.7, RUL-017, RUL-024)
 *
 * Post endpoints: create, read, edit, delete, and list by user.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { requireActive, authenticate } from '../../middleware/auth.js';
import { postsLimiter } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import { createPostSchema, editPostSchema, listPostsQuerySchema } from '@app/shared';
import { createPost, getPostById, editPost, deletePost, getUserPosts } from './service.js';

export const postsRouter = Router();

// POST /posts
postsRouter.post(
  '/posts',
  requireActive,
  postsLimiter,
  validate({ body: createPostSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const post = await createPost({ id: user.id, q: user.q, role: user.role }, req.body);
      res.status(201).json(post);
    } catch (err) {
      next(err);
    }
  },
);

// GET /posts/:id
postsRouter.get(
  '/posts/:id',
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const viewer = req.user ? { id: req.user.id, role: req.user.role } : undefined;
      const post = await getPostById(req.params.id as string, viewer);
      res.status(200).json(post);
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /posts/:id
postsRouter.patch(
  '/posts/:id',
  requireActive,
  validate({ body: editPostSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const post = await editPost(req.params.id as string, req.user!.id, req.body);
      res.status(200).json(post);
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /posts/:id
postsRouter.delete(
  '/posts/:id',
  requireActive,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const isAdmin = req.user!.role === 'admin';
      await deletePost(req.params.id as string, req.user!.id, isAdmin);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

// GET /users/:username/posts
postsRouter.get(
  '/users/:username/posts',
  authenticate,
  validate({ query: listPostsQuerySchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const viewer = req.user ? { id: req.user.id, role: req.user.role } : undefined;
      const query = req.query as unknown as { cursor?: string; limit?: number };
      const limit = query.limit ?? 20;

      const result = await getUserPosts(
        req.params.username as string,
        { cursor: query.cursor, limit },
        viewer,
      );

      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);
