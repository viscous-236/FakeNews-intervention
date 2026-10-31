/**
 * apps/api/src/middleware/rateLimit.ts (TASK-037, SEC-006, Section 1.7)
 *
 * In-memory rate limiters producing standard error envelopes and Retry-After headers.
 */

import rateLimit, { RateLimitRequestHandler } from 'express-rate-limit';
import { Request, Response } from 'express';

export function createLimiter(
  windowMs: number,
  max: number,
  message = 'Too many requests, please try again later',
  keyByUser = false,
): RateLimitRequestHandler {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    validate: {
      keyGeneratorIpFallback: false,
    },
    keyGenerator: (req: Request): string => {
      if (keyByUser) {
        const user = (req as Request & { user?: { id: string } }).user;
        if (user?.id) return `user_${user.id}`;
      }
      return req.ip || req.socket.remoteAddress || 'unknown';
    },
    handler: (req: Request, res: Response): void => {
      const requestId = (req as Request & { id?: string }).id ?? '';
      res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message,
          requestId,
        },
      });
    },
  });
}

// Global & Auth rate limits (per IP)
export const globalLimiter = createLimiter(60 * 1000, 300);
export const loginLimiter = createLimiter(60 * 1000, 10, 'Login rate limit exceeded');
export const registerLimiter = createLimiter(60 * 60 * 1000, 5, 'Register rate limit exceeded');
export const forgotPasswordLimiter = createLimiter(60 * 60 * 1000, 5, 'Forgot password rate limit exceeded');
export const resendVerificationLimiter = createLimiter(60 * 60 * 1000, 3, 'Resend verification limit exceeded', true);

// Domain rate limits (keyed by user id when authenticated, else IP)
export const postsLimiter = createLimiter(60 * 60 * 1000, 20, 'Posts rate limit exceeded', true);
export const commentsLimiter = createLimiter(60 * 60 * 1000, 60, 'Comments rate limit exceeded', true);
export const likesLimiter = createLimiter(60 * 60 * 1000, 300, 'Likes rate limit exceeded', true);
export const resharesLimiter = createLimiter(60 * 60 * 1000, 60, 'Reshares rate limit exceeded', true);
export const reportsLimiter = createLimiter(60 * 60 * 1000, 30, 'Reports rate limit exceeded', true);
export const mediaLimiter = createLimiter(60 * 60 * 1000, 30, 'Media upload rate limit exceeded', true);
export const messagesLimiter = createLimiter(60 * 60 * 1000, 120, 'Messages rate limit exceeded', true);
export const followsLimiter = createLimiter(60 * 60 * 1000, 100, 'Follows rate limit exceeded', true);
export const appealsLimiter = createLimiter(24 * 60 * 60 * 1000, 5, 'Appeals daily rate limit exceeded', true);
export const searchLimiter = createLimiter(60 * 1000, 60, 'Search rate limit exceeded', true);
