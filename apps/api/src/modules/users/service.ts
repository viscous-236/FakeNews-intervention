/**
 * apps/api/src/modules/users/service.ts (TASK-016)
 *
 * User domain service rules (GUD-001, GUD-002, SEC-001).
 */

import * as argon2 from 'argon2';
import { config } from '../../config.js';
import { type PoolClient } from '../../db/pool.js';
import { insertUser, type UserRow } from './repo.js';

export interface CreateUserInput {
  username: string;
  email: string;
  password: string;
  displayName: string;
  sigma?: number;
  role?: 'user' | 'admin';
  emailVerified?: boolean;
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
