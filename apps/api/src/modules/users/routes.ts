/**
 * apps/api/src/modules/users/routes.ts (TASK-040)
 *
 * User profile and settings endpoints.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { updateMeSchema } from '@app/shared';
import { validate } from '../../middleware/validate.js';
import { authenticate, requireActive } from '../../middleware/auth.js';
import { getUserProfile, updateProfile } from './service.js';

export const usersRouter = Router();

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
