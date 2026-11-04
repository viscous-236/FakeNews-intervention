/**
 * apps/api/src/modules/users/routes.ts (TASK-040, TASK-046, RUL-022, SEC-014)
 *
 * User profile, settings, account deletion, and export endpoints.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { deleteMeSchema, listUsersQuerySchema, updateMeSchema } from '@app/shared';
import { config } from '../../config.js';
import { validate } from '../../middleware/validate.js';
import { authenticate, requireAuth, requireActive } from '../../middleware/auth.js';
import { followsLimiter } from '../../middleware/rateLimit.js';
import { getUserProfile, updateProfile, deleteAccount, exportAccount } from './service.js';
import { blockUser, followUser, unblockUser, unfollowUser } from '../social/follows.js';
import { getSuggestions, listBlockedUsers, listConnections } from '../social/people.js';
import { z } from 'zod';

export const usersRouter = Router();
const usernameParams = z.object({ username: z.string().min(3).max(20) }).strict();

// GET /users/me/export (Auth: any signed-in user, per line 878)
usersRouter.get(
  '/users/me/export',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await exportAccount(req.user!);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="export-${req.user!.username}.json"`,
      );
      res.status(200).json(data);
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /users/me (Active users only: status='active')
usersRouter.patch(
  '/users/me',
  requireActive,
  validate({ body: updateMeSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const updatedUser = await updateProfile(req.user!.id, req.body);
      res.status(200).json({ user: updatedUser });
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /users/me (Auth: any signed-in user, per line 877)
usersRouter.delete(
  '/users/me',
  requireAuth,
  validate({ body: deleteMeSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await deleteAccount(req.user!, req.body.password);
      res.clearCookie(config.SESSION_COOKIE_NAME);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

usersRouter.get(
  '/users/me/blocks',
  requireAuth,
  validate({ query: listUsersQuerySchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = req.query as unknown as { cursor?: string; limit?: number };
      res.json(await listBlockedUsers(req.user!.id, query.cursor, query.limit ?? 20));
    } catch (error) {
      next(error);
    }
  },
);

usersRouter.get(
  '/users/suggestions',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.json(await getSuggestions(req.user!.id));
    } catch (error) {
      next(error);
    }
  },
);

usersRouter.get(
  '/users/:username/followers',
  authenticate,
  validate({ params: usernameParams, query: listUsersQuerySchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = req.query as unknown as { cursor?: string; limit?: number };
      res.json(
        await listConnections(
          req.params.username as string,
          'followers',
          req.user?.id,
          query.cursor,
          query.limit ?? 20,
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);

usersRouter.get(
  '/users/:username/following',
  authenticate,
  validate({ params: usernameParams, query: listUsersQuerySchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = req.query as unknown as { cursor?: string; limit?: number };
      res.json(
        await listConnections(
          req.params.username as string,
          'following',
          req.user?.id,
          query.cursor,
          query.limit ?? 20,
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);

usersRouter.post(
  '/users/:username/follow',
  requireActive,
  followsLimiter,
  validate({ params: usernameParams }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await followUser(req.user!.id, req.params.username as string);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);

usersRouter.delete(
  '/users/:username/follow',
  requireActive,
  followsLimiter,
  validate({ params: usernameParams }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await unfollowUser(req.user!.id, req.params.username as string);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);

usersRouter.post(
  '/users/:username/block',
  requireActive,
  followsLimiter,
  validate({ params: usernameParams }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await blockUser(req.user!.id, req.params.username as string);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);

usersRouter.delete(
  '/users/:username/block',
  requireActive,
  followsLimiter,
  validate({ params: usernameParams }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await unblockUser(req.user!.id, req.params.username as string);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);

// GET /users/:username (Public, optional auth for viewer state & RUL-023 q visibility)
usersRouter.get(
  '/users/:username',
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const rawUsername = req.params.username;
      const username =
        typeof rawUsername === 'string'
          ? rawUsername
          : Array.isArray(rawUsername) && rawUsername[0]
            ? rawUsername[0]
            : '';
      const viewer = req.user ? { id: req.user.id, role: req.user.role } : undefined;
      const profile = await getUserProfile(username, viewer);
      res.status(200).json(profile);
    } catch (err) {
      next(err);
    }
  },
);
