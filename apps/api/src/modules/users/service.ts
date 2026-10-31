/**
 * apps/api/src/modules/users/service.ts (TASK-016, TASK-040)
 *
 * User domain service rules (GUD-001, GUD-002, SEC-001, RUL-023).
 */

import * as argon2 from 'argon2';
import { UpdateMeInput } from '@app/shared';
import { config } from '../../config.js';
import { type PoolClient } from '../../db/pool.js';
import { withTransaction } from '../../db/tx.js';
import { AppError } from '../../middleware/errors.js';
import {
  insertUser,
  findUserByUsername,
  getUserCounts,
  getViewerRelationship,
  checkMediaExists,
  updateUserProfile,
  anonymizeUser,
  fetchUserExportData,
  type UserRow,
  type UserCounts,
  type ViewerRelationship,
  type UserExportData,
} from './repo.js';

export interface CreateUserInput {
  username: string;
  email: string;
  password: string;
  displayName: string;
  sigma?: number;
  role?: 'user' | 'admin';
  emailVerified?: boolean;
}

export interface UserSummary {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  tier: 'trusted' | 'neutral' | 'low';
}

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

export interface PublicUserProfile {
  id: string;
  username: string;
  displayName: string;
  bio: string;
  avatarUrl: string | null;
  tier: 'trusted' | 'neutral' | 'low';
  q?: string;
  counts: UserCounts;
  viewer: ViewerRelationship;
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

/**
 * Hash password with argon2id per SEC-001:
 * memoryCost 19456 KiB, timeCost 2, parallelism 1
 */
export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
}

/**
 * Verify password against argon2 hash.
 */
export async function verifyPassword(
  hash: string,
  plain: string,
): Promise<boolean> {
  return argon2.verify(hash, plain);
}

/**
 * Create a user with argon2id password hash, sigma validation, and optional verification.
 * Reused by scripts/create-user.ts and scripts/create-admin.ts.
 */
export async function createUser(
  input: CreateUserInput,
  client?: PoolClient,
): Promise<UserRow> {
  const sigma = input.sigma !== undefined ? input.sigma : config.SIGMA_DEFAULT;

  if (typeof sigma !== 'number' || Number.isNaN(sigma) || sigma < 0 || sigma > 1) {
    throw new Error('sigma must be between 0 and 1');
  }

  const passwordHash = await hashPassword(input.password);
  const emailVerifiedAt = input.emailVerified ? new Date() : null;

  return insertUser(
    {
      username: input.username,
      email: input.email,
      passwordHash,
      displayName: input.displayName,
      role: input.role ?? 'user',
      sigma,
      emailVerifiedAt,
    },
    client,
  );
}

/**
 * Get public user profile with RUL-023 score visibility.
 */
export async function getUserProfile(
  username: string,
  viewer?: { id: string; role: 'user' | 'admin' },
): Promise<PublicUserProfile> {
  const user = await findUserByUsername(username);
  if (!user || user.status === 'deleted' || user.deleted_at !== null) {
    throw new AppError(404, 'NOT_FOUND', 'User not found');
  }

  const counts = await getUserCounts(user.id);
  const viewerRelationship = viewer
    ? await getViewerRelationship(viewer.id, user.id)
    : { following: false, blocked: false };

  // RUL-023: q is visible only to the user and admins when PUBLIC_SCORE_VISIBILITY = 'tier_only';
  // 'full' makes q public (sigma stays private).
  const isSelf = viewer?.id === user.id;
  const isAdmin = viewer?.role === 'admin';
  const showQ = config.PUBLIC_SCORE_VISIBILITY === 'full' || isSelf || isAdmin;

  const qNum = parseFloat(user.q);
  const qStr = (isNaN(qNum) ? 0 : qNum).toFixed(3);

  const profile: PublicUserProfile = {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    bio: user.bio,
    avatarUrl: user.avatar_media_id
      ? `${config.S3_PUBLIC_BASE_URL}/${user.avatar_media_id}`
      : null,
    tier: computeTier(qNum),
    ...(showQ ? { q: qStr } : {}),
    counts,
    viewer: viewerRelationship,
    createdAt: new Date(user.created_at).toISOString(),
  };

  return profile;
}

/**
 * Update current user profile (PATCH /users/me).
 */
export async function updateProfile(
  userId: string,
  input: UpdateMeInput,
): Promise<MeUser> {
  if (input.avatarMediaId) {
    const exists = await checkMediaExists(input.avatarMediaId);
    if (!exists) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Avatar media not found');
    }
  }

  const updated = await updateUserProfile(userId, {
    displayName: input.displayName,
    bio: input.bio,
    avatarMediaId: input.avatarMediaId,
  });

  return toMeUser(updated);
}

/**
 * Delete account (DELETE /users/me per RUL-022, SEC-014).
 * Verifies password, anonymizes PII and purges active sessions.
 */
export async function deleteAccount(
  user: UserRow,
  password: string,
): Promise<void> {
  const valid = await verifyPassword(user.password_hash, password);
  if (!valid) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect password');
  }

  await withTransaction(async (tx) => {
    await anonymizeUser(user.id, tx);
  });
}

/**
 * Export account data (GET /users/me/export per line 878).
 */
export async function exportAccount(user: UserRow): Promise<UserExportData> {
  return fetchUserExportData(user, config.S3_PUBLIC_BASE_URL);
}
