/**
 * apps/api/src/middleware/auth.ts (TASK-037, SEC-002, SEC-010)
 *
 * Session authentication and authorization guards (requireAuth, requireActive, requireAdmin).
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { config } from '../config.js';
import { getPool } from '../db/pool.js';
import { AppError } from './errors.js';

export interface RequestUser {
  id: string;
  username: string;
  email: string;
  password_hash: string;
  display_name: string;
  bio: string;
  avatar_media_id: string | null;
  role: 'user' | 'admin';
  status: 'active' | 'suspended' | 'deleted';
  sigma: string;
  q: string;
  email_verified_at: Date | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface RequestSession {
  id: string;
  user_id: string;
  token_hash: string;
  created_at: Date;
  expires_at: Date;
  last_seen_at: Date;
  user_agent: string | null;
  ip: string | null;
}

/* eslint-disable @typescript-eslint/no-namespace */
declare global {
  namespace Express {
    interface Request {
      user?: RequestUser;
      session?: RequestSession;
    }
  }
}
/* eslint-enable @typescript-eslint/no-namespace */

export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.cookies?.[config.SESSION_COOKIE_NAME];
    if (!token || typeof token !== 'string') {
      return next();
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const pool = getPool();

    const result = await pool.query<{
      session_id: string;
      session_user_id: string;
      session_token_hash: string;
      session_created_at: Date;
      expires_at: Date;
      last_seen_at: Date;
      user_agent: string | null;
      ip: string | null;
      id: string;
      username: string;
      email: string;
      password_hash: string;
      display_name: string;
      bio: string;
      avatar_media_id: string | null;
      role: 'user' | 'admin';
      status: 'active' | 'suspended' | 'deleted';
      sigma: string;
      q: string;
      email_verified_at: Date | null;
      created_at: Date;
      updated_at: Date;
      deleted_at: Date | null;
    }>(
      `SELECT
        s.id AS session_id, s.user_id AS session_user_id, s.token_hash AS session_token_hash,
        s.created_at AS session_created_at, s.expires_at, s.last_seen_at, s.user_agent, s.ip,
        u.id, u.username, u.email, u.password_hash, u.display_name, u.bio,
        u.avatar_media_id, u.role, u.status, u.sigma, u.q, u.email_verified_at,
        u.created_at, u.updated_at, u.deleted_at
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1`,
      [tokenHash],
    );

    const row = result.rows[0];
    if (!row) {
      return next();
    }

    // Check expiry
    if (new Date(row.expires_at) <= new Date()) {
      await pool.query(`DELETE FROM sessions WHERE id = $1`, [row.session_id]);
      return next();
    }

    // Check if user is soft-deleted
    if (row.deleted_at !== null || row.status === 'deleted') {
      return next();
    }

    req.session = {
      id: row.session_id,
      user_id: row.session_user_id,
      token_hash: row.session_token_hash,
      created_at: row.session_created_at,
      expires_at: row.expires_at,
      last_seen_at: row.last_seen_at,
      user_agent: row.user_agent,
      ip: row.ip,
    };

    req.user = {
      id: row.id,
      username: row.username,
      email: row.email,
      password_hash: row.password_hash,
      display_name: row.display_name,
      bio: row.bio,
      avatar_media_id: row.avatar_media_id,
      role: row.role,
      status: row.status,
      sigma: row.sigma,
      q: row.q,
      email_verified_at: row.email_verified_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
      deleted_at: row.deleted_at,
    };

    next();
  } catch (err) {
    next(err);
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) {
    await authenticate(req, res, () => {
      if (!req.user) {
        return next(new AppError(401, 'UNAUTHENTICATED', 'Authentication required'));
      }
      next();
    });
    return;
  }
  next();
}

export async function requireActive(req: Request, res: Response, next: NextFunction): Promise<void> {
  await requireAuth(req, res, (err?: unknown) => {
    if (err) return next(err);
    if (!req.user) {
      return next(new AppError(401, 'UNAUTHENTICATED', 'Authentication required'));
    }
    if (req.user.status === 'suspended') {
      return next(new AppError(403, 'ACCOUNT_SUSPENDED', 'Account is suspended'));
    }
    if (req.user.status !== 'active') {
      return next(new AppError(403, 'FORBIDDEN', 'Account is not active'));
    }
    if (config.REQUIRE_EMAIL_VERIFICATION && !req.user.email_verified_at) {
      return next(new AppError(403, 'EMAIL_NOT_VERIFIED', 'Email verification required'));
    }
    next();
  });
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  await requireActive(req, res, (err?: unknown) => {
    if (err) return next(err);
    if (!req.user) {
      return next(new AppError(401, 'UNAUTHENTICATED', 'Authentication required'));
    }
    if (req.user.role !== 'admin') {
      return next(new AppError(403, 'FORBIDDEN', 'Admin privileges required'));
    }
    next();
  });
}
