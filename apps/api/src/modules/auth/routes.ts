/**
 * apps/api/src/modules/auth/routes.ts (TASK-038)
 *
 * Authentication routes: register, login, logout, me.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { registerSchema, loginSchema } from '@app/shared';
import { config } from '../../config.js';
import { validate } from '../../middleware/validate.js';
import { registerLimiter, loginLimiter } from '../../middleware/rateLimit.js';
import { requireAuth } from '../../middleware/auth.js';
import { register, login, logout, toMeUser } from './service.js';

export const authRouter = Router();

function setSessionCookie(res: Response, token: string): void {
  res.cookie(config.SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    maxAge: config.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
  });
}

function clearSessionCookie(res: Response): void {
  res.clearCookie(config.SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
  });
}

// POST /auth/register
authRouter.post(
  '/auth/register',
  registerLimiter,
  validate({ body: registerSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userAgent = req.headers['user-agent'] ?? null;
      const ip = req.ip || req.socket.remoteAddress || null;
      const { user, sessionToken } = await register(req.body, ip, userAgent);

      setSessionCookie(res, sessionToken);
      res.status(201).json({ user });
    } catch (err) {
      next(err);
    }
  },
);

// POST /auth/login
authRouter.post(
  '/auth/login',
  loginLimiter,
  validate({ body: loginSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userAgent = req.headers['user-agent'] ?? null;
      const ip = req.ip || req.socket.remoteAddress || null;
      const { user, sessionToken } = await login(req.body, ip, userAgent);

      setSessionCookie(res, sessionToken);
      res.status(200).json({ user });
    } catch (err) {
      next(err);
    }
  },
);

// POST /auth/logout
authRouter.post(
  '/auth/logout',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const token = req.cookies?.[config.SESSION_COOKIE_NAME];
      await logout(token);
      clearSessionCookie(res);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);

// GET /auth/me
authRouter.get(
  '/auth/me',
  requireAuth,
  (req: Request, res: Response): void => {
    res.status(200).json({ user: toMeUser(req.user!) });
  },
);
