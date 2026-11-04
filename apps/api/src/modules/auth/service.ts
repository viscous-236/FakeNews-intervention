/**
 * apps/api/src/modules/auth/service.ts (TASK-038, SEC-001, SEC-002, SEC-003)
 *
 * Authentication service handling registration, login with lockout defense,
 * logout, and Me payload serialization.
 */

import crypto from 'crypto';
import { RegisterInput, LoginInput } from '@app/shared';
import { config } from '../../config.js';
import { withTransaction } from '../../db/tx.js';
import { AppError } from '../../middleware/errors.js';
import {
  createUser,
  verifyPassword,
  hashPassword,
  toMeUser,
  type MeUser,
} from '../users/service.js';
import { type UserRow, findUserById } from '../users/repo.js';
import {
  checkUsernameOrEmailTaken,
  findUserByIdentifier,
  createSession,
  deleteSessionByTokenHash,
  createEmailToken,
  queueOutboxEmail,
  findEmailTokenByHash,
  markEmailTokenUsed,
  updateUserPassword,
  deleteAllUserSessions,
  deleteUserSessionsExcept,
  findUserSessions,
  deleteSessionById,
} from './repo.js';

export { toMeUser, type MeUser, type UserRow };

// ---------------------------------------------------------------------------
// Failed login lockout tracking (SEC-003)
// 5 failed attempts per identifier+IP within 15 minutes -> 429 RATE_LIMITED
// ---------------------------------------------------------------------------
interface FailedAttemptRecord {
  count: number;
  resetAt: number;
}

const failedAttempts = new Map<string, FailedAttemptRecord>();

function getLockoutKey(identifier: string, ip: string): string {
  return `${identifier.trim().toLowerCase()}:${ip.trim()}`;
}

export function checkLoginLockout(identifier: string, ip: string): void {
  const key = getLockoutKey(identifier, ip);
  const record = failedAttempts.get(key);
  if (!record) return;

  if (Date.now() > record.resetAt) {
    failedAttempts.delete(key);
    return;
  }

  if (record.count >= 5) {
    throw new AppError(
      429,
      'RATE_LIMITED',
      'Too many failed login attempts. Please try again later.',
    );
  }
}

export function recordFailedLogin(identifier: string, ip: string): void {
  const key = getLockoutKey(identifier, ip);
  const record = failedAttempts.get(key);
  const windowMs = 15 * 60 * 1000;

  if (!record || Date.now() > record.resetAt) {
    failedAttempts.set(key, {
      count: 1,
      resetAt: Date.now() + windowMs,
    });
  } else {
    record.count += 1;
  }
}

export function clearLoginLockout(identifier: string, ip: string): void {
  failedAttempts.delete(getLockoutKey(identifier, ip));
}

// ---------------------------------------------------------------------------
// Service operations
// ---------------------------------------------------------------------------
export async function register(
  input: RegisterInput,
  ip: string | null,
  userAgent: string | null,
): Promise<{ user: MeUser; sessionToken: string }> {
  // Case-insensitive duplicate check (TEST-041)
  const { usernameTaken, emailTaken } = await checkUsernameOrEmailTaken(
    input.username,
    input.email,
  );
  if (usernameTaken) {
    throw new AppError(409, 'USERNAME_TAKEN', 'Username is already taken');
  }
  if (emailTaken) {
    throw new AppError(409, 'EMAIL_TAKEN', 'Email is already registered');
  }

  return withTransaction(async (tx) => {
    // 1. Create user with default sigma (DEC-017: no email verification step)
    const userRow = await createUser(
      {
        username: input.username,
        email: input.email,
        password: input.password,
        displayName: input.displayName,
        sigma: config.SIGMA_DEFAULT,
      },
      tx,
    );

    // 2. Create active session
    const rawSessionToken = crypto.randomBytes(32).toString('base64url');
    const sessionTokenHash = crypto.createHash('sha256').update(rawSessionToken).digest('hex');
    const sessionExpiry = new Date(Date.now() + config.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
    await createSession(userRow.id, sessionTokenHash, sessionExpiry, userAgent, ip, tx);

    return {
      user: toMeUser(userRow),
      sessionToken: rawSessionToken,
    };
  });
}

export async function login(
  input: LoginInput,
  ip: string | null,
  userAgent: string | null,
): Promise<{ user: MeUser; sessionToken: string }> {
  const clientIp = ip || 'unknown';

  // 1. Check rate-limit lockout defense
  checkLoginLockout(input.identifier, clientIp);

  // 2. Find user
  const user = await findUserByIdentifier(input.identifier);
  if (!user) {
    recordFailedLogin(input.identifier, clientIp);
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid credentials');
  }

  // 3. Verify password hash
  const validPassword = await verifyPassword(user.password_hash, input.password);
  if (!validPassword) {
    recordFailedLogin(input.identifier, clientIp);
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid credentials');
  }

  // 4. Check if user is deleted or suspended
  if (user.deleted_at !== null || user.status === 'deleted') {
    recordFailedLogin(input.identifier, clientIp);
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid credentials');
  }

  // Successful login -> clear lockout tracker
  clearLoginLockout(input.identifier, clientIp);

  // 5. Create new session
  const rawSessionToken = crypto.randomBytes(32).toString('base64url');
  const sessionTokenHash = crypto.createHash('sha256').update(rawSessionToken).digest('hex');
  const sessionExpiry = new Date(Date.now() + config.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await createSession(user.id, sessionTokenHash, sessionExpiry, userAgent, ip);

  return {
    user: toMeUser(user),
    sessionToken: rawSessionToken,
  };
}

export async function logout(rawToken?: string): Promise<void> {
  if (!rawToken) return;
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  await deleteSessionByTokenHash(tokenHash);
}

// ---------------------------------------------------------------------------
// Token & Session operations (TASK-039)
// ---------------------------------------------------------------------------

export async function forgotPassword(email: string): Promise<void> {
  const user = await findUserByIdentifier(email);
  if (!user || user.status === 'deleted' || user.deleted_at !== null) {
    // SEC-009: Anti-enumeration. Always return 204 with no mail.
    return;
  }

  await withTransaction(async (tx) => {
    const rawResetToken = crypto.randomBytes(32).toString('base64url');
    const resetTokenHash = crypto.createHash('sha256').update(rawResetToken).digest('hex');
    const resetExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await createEmailToken(user.id, 'reset_password', resetTokenHash, resetExpiry, tx);

    const resetUrl = `${config.APP_ORIGIN}/reset-password?token=${rawResetToken}`;
    await queueOutboxEmail(
      user.email,
      'Reset your password',
      `You requested a password reset for FakeNews-intervention.\n\nClick the link below to set a new password:\n${resetUrl}\n\nIf you did not request this, you can safely ignore this email.`,
      tx,
    );
  });
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const tokenRow = await findEmailTokenByHash(tokenHash, 'reset_password');
  if (
    !tokenRow ||
    tokenRow.used_at !== null ||
    new Date(tokenRow.expires_at).getTime() < Date.now()
  ) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid or expired reset token');
  }

  const passwordHash = await hashPassword(newPassword);

  await withTransaction(async (tx) => {
    await updateUserPassword(tokenRow.user_id, passwordHash, tx);
    await markEmailTokenUsed(tokenRow.id, tx);
    await deleteAllUserSessions(tokenRow.user_id, tx); // SEC-013
  });
}

export async function changePassword(
  userId: string,
  currentSessionId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await findUserById(userId);
  if (!user) {
    throw new AppError(401, 'UNAUTHENTICATED', 'User not found');
  }

  const validPassword = await verifyPassword(user.password_hash, currentPassword);
  if (!validPassword) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Current password is incorrect');
  }

  const passwordHash = await hashPassword(newPassword);

  await withTransaction(async (tx) => {
    await updateUserPassword(userId, passwordHash, tx);
    await deleteUserSessionsExcept(userId, currentSessionId, tx);
  });
}

export interface SessionItem {
  id: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
  userAgent: string | null;
  ip: string | null;
  isCurrent: boolean;
}

export async function listSessions(
  userId: string,
  currentSessionId?: string,
): Promise<SessionItem[]> {
  const sessions = await findUserSessions(userId);
  return sessions.map((s) => ({
    id: s.id,
    createdAt: new Date(s.created_at).toISOString(),
    expiresAt: new Date(s.expires_at).toISOString(),
    lastSeenAt: new Date(s.last_seen_at).toISOString(),
    userAgent: s.user_agent,
    ip: s.ip,
    isCurrent: s.id === currentSessionId,
  }));
}

export async function revokeSession(userId: string, targetSessionId: string): Promise<void> {
  const deleted = await deleteSessionById(targetSessionId, userId);
  if (!deleted) {
    throw new AppError(404, 'NOT_FOUND', 'Session not found');
  }
}
