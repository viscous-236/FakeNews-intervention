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
import { createUser, verifyPassword } from '../users/service.js';
import { type UserRow } from '../users/repo.js';
import {
  checkUsernameOrEmailTaken,
  findUserByIdentifier,
  createSession,
  deleteSessionByTokenHash,
  createEmailToken,
  queueOutboxEmail,
} from './repo.js';

export interface MeUser {
  id: string;
  username: string;
  email: string;
  displayName: string;
  bio: string;
  avatarUrl: string | null;
  role: 'user' | 'admin';
  status: 'active' | 'suspended' | 'deleted';
  emailVerified: boolean;
  score: {
    q: string;
    sigma: string;
    tier: 'trusted' | 'neutral' | 'low';
  };
  createdAt: string;
}

export function computeTier(q: string | number): 'trusted' | 'neutral' | 'low' {
  const num = typeof q === 'string' ? parseFloat(q) : q;
  if (num >= config.Q_TRUSTED_MIN) return 'trusted';
  if (num <= config.Q_LOW_MAX) return 'low';
  return 'neutral';
}

export function toMeUser(user: UserRow): MeUser {
  const qNum = parseFloat(user.q);
  const qStr = (isNaN(qNum) ? 0 : qNum).toFixed(3);
  const sigmaNum = parseFloat(user.sigma);
  const sigmaStr = (isNaN(sigmaNum) ? 0.5 : sigmaNum).toFixed(3);

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    displayName: user.display_name,
    bio: user.bio,
    avatarUrl: user.avatar_media_id
      ? `${config.S3_PUBLIC_BASE_URL}/${user.avatar_media_id}`
      : null,
    role: user.role,
    status: user.status,
    emailVerified: Boolean(user.email_verified_at),
    score: {
      q: qStr,
      sigma: sigmaStr,
      tier: computeTier(qNum),
    },
    createdAt: new Date(user.created_at).toISOString(),
  };
}

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
    // 1. Create user with default sigma, unverified
    const userRow = await createUser(
      {
        username: input.username,
        email: input.email,
        password: input.password,
        displayName: input.displayName,
        sigma: config.SIGMA_DEFAULT,
        emailVerified: false,
      },
      tx,
    );

    // 2. Generate email verification token (24-hour expiry)
    const rawVerifyToken = crypto.randomBytes(32).toString('base64url');
    const verifyTokenHash = crypto
      .createHash('sha256')
      .update(rawVerifyToken)
      .digest('hex');
    const verifyExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await createEmailToken(
      userRow.id,
      'verify_email',
      verifyTokenHash,
      verifyExpiry,
      tx,
    );

    // 3. Queue verification email into transactional outbox
    const verifyUrl = `${config.APP_ORIGIN}/verify-email?token=${rawVerifyToken}`;
    await queueOutboxEmail(
      userRow.email,
      'Verify your email address',
      `Welcome to FakeNews-intervention!\n\nPlease verify your email by clicking the link below:\n${verifyUrl}`,
      tx,
    );

    // 4. Create active session
    const rawSessionToken = crypto.randomBytes(32).toString('base64url');
    const sessionTokenHash = crypto
      .createHash('sha256')
      .update(rawSessionToken)
      .digest('hex');
    const sessionExpiry = new Date(
      Date.now() + config.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
    );
    await createSession(
      userRow.id,
      sessionTokenHash,
      sessionExpiry,
      userAgent,
      ip,
      tx,
    );

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
  const sessionTokenHash = crypto
    .createHash('sha256')
    .update(rawSessionToken)
    .digest('hex');
  const sessionExpiry = new Date(
    Date.now() + config.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
  );
  await createSession(
    user.id,
    sessionTokenHash,
    sessionExpiry,
    userAgent,
    ip,
  );

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
