/**
 * apps/api/src/modules/auth/routes.ts (TASK-038)
 *
 * Authentication routes: register, login, logout, me.
 */

import { Router, Request, Response, NextFunction } from 'express';
import {
  registerSchema,
  loginSchema,
  verifyEmailSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
} from '@app/shared';
import { config } from '../../config.js';
import { validate } from '../../middleware/validate.js';
import {
  registerLimiter,
  loginLimiter,
  forgotPasswordLimiter,
  resendVerificationLimiter,
} from '../../middleware/rateLimit.js';
import { requireAuth } from '../../middleware/auth.js';
import {
  register,
  login,
  logout,
  toMeUser,
  verifyEmail,
  resendVerification,
  forgotPassword,
  resetPassword,
  changePassword,
  listSessions,
  revokeSession,
} from './service.js';

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

// POST /auth/verify-email
authRouter.post(
  '/auth/verify-email',
  validate({ body: verifyEmailSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await verifyEmail(req.body.token);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);

// POST /auth/resend-verification
authRouter.post(
  '/auth/resend-verification',
  requireAuth,
  resendVerificationLimiter,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await resendVerification(req.user!.id);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);

// POST /auth/forgot-password
authRouter.post(
  '/auth/forgot-password',
  forgotPasswordLimiter,
  validate({ body: forgotPasswordSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await forgotPassword(req.body.email);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);

// POST /auth/reset-password
authRouter.post(
  '/auth/reset-password',
  validate({ body: resetPasswordSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await resetPassword(req.body.token, req.body.password);
      clearSessionCookie(res);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);

// POST /auth/change-password
authRouter.post(
  '/auth/change-password',
  requireAuth,
  validate({ body: changePasswordSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await changePassword(
        req.user!.id,
        req.session!.id,
        req.body.currentPassword,
        req.body.newPassword,
      );
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);

// GET /auth/sessions
authRouter.get(
  '/auth/sessions',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const sessions = await listSessions(req.user!.id, req.session?.id);
      res.status(200).json(sessions);
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /auth/sessions/:id
authRouter.delete(
  '/auth/sessions/:id',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const targetSessionId =
        typeof req.params.id === 'string'
          ? req.params.id
          : Array.isArray(req.params.id)
            ? req.params.id[0]
            : '';
      if (!targetSessionId) {
        res.status(404).end();
        return;
      }
      await revokeSession(req.user!.id, targetSessionId);
      if (req.session?.id === targetSessionId) {
        clearSessionCookie(res);
      }
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);
