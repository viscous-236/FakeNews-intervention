/**
 * Test data factories (TASK-008).
 *
 * Factories create test fixtures through the real service layer or direct SQL.
 * They are expanded in later phases as modules are implemented.
 *
 * All factories accept a partial override object so tests can supply only the
 * fields they care about.
 */

import { Pool } from 'pg';
import crypto from 'crypto';
import { getTestPool } from './db';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _uid(): string {
  return crypto.randomUUID();
}

function uniqueName(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(4).toString('hex')}`;
}

// ---------------------------------------------------------------------------
// User factory (direct SQL — auth service implemented in TASK-038)
// ---------------------------------------------------------------------------

export interface CreateUserOpts {
  username?: string;
  email?: string;
  displayName?: string;
  role?: 'user' | 'admin';
  status?: 'active' | 'suspended' | 'deleted';
  sigma?: number;
  emailVerified?: boolean;
}

export interface UserRow {
  id: string;
  username: string;
  email: string;
  display_name: string;
  role: string;
  status: string;
  sigma: string;
  q: string;
}

export async function createTestUser(
  opts: CreateUserOpts = {},
  pool: Pool = getTestPool(),
): Promise<UserRow> {
  const username = opts.username ?? uniqueName('user');
  const email = opts.email ?? `${username}@test.example`;
  const sigma = opts.sigma ?? 0.5;

  const result = await pool.query<UserRow>(
    `INSERT INTO users
       (username, email, password_hash, display_name, role, status, sigma, email_verified_at)
     VALUES
       ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      username,
      email,
      // Placeholder hash — real argon2 added in TASK-016
      '$argon2id$placeholder',
      opts.displayName ?? username,
      opts.role ?? 'user',
      opts.status ?? 'active',
      sigma,
      opts.emailVerified !== false ? new Date() : null,
    ],
  );

  return result.rows[0]!;
}
