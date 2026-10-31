/**
 * apps/api/src/modules/users/routes.ts (TASK-040, TASK-046, RUL-022, SEC-014)
 *
 * User profile, settings, account deletion, and export endpoints.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { updateMeSchema, deleteMeSchema } from '@app/shared';
import { config } from '../../config.js';
import { validate } from '../../middleware/validate.js';
import { authenticate, requireAuth, requireActive } from '../../middleware/auth.js';
import {
  getUserProfile,
  updateProfile,
  deleteAccount,
  exportAccount,
} from './service.js';

export const usersRouter = Router();

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

// PATCH /users/me (Active users only: status='active', emailVerified=true)
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
