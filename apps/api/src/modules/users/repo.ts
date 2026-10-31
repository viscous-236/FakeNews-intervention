/**
 * apps/api/src/modules/users/repo.ts (TASK-016)
 *
 * SQL repository for users table (GUD-001, GUD-002, PAT-001).
 */

import { type PoolClient } from '../../db/pool.js';
import { getPool } from '../../db/pool.js';

export interface UserRow {
  id: string;
  username: string;
  email: string;
  password_hash: string;
  display_name: string;
  bio: string;
  avatar_media_id: string | null;
  role: 'user' | 'admin';
  status: 'active' | 'suspended' | 'deleted';
  sigma: string; // numeric as string
  q: string;     // numeric as string
  email_verified_at: Date | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface InsertUserParams {
  username: string;
  email: string;
  passwordHash: string;
  displayName: string;
  role?: 'user' | 'admin';
  sigma: number;
  emailVerifiedAt?: Date | null;
}

export async function insertUser(
  params: InsertUserParams,
  client?: PoolClient,
): Promise<UserRow> {
  const executor = client ?? getPool();
  const sql = `
    INSERT INTO users (
      username,
      email,
      password_hash,
      display_name,
      role,
      sigma,
      email_verified_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING
      id, username, email, password_hash, display_name, bio,
      avatar_media_id, role, status, sigma, q, email_verified_at,
      created_at, updated_at, deleted_at
  `;
  const values = [
    params.username,
    params.email,
    params.passwordHash,
    params.displayName,
    params.role ?? 'user',
    params.sigma.toFixed(3),
    params.emailVerifiedAt ?? null,
  ];
  const res = await executor.query<UserRow>(sql, values);
  const row = res.rows[0];
  if (!row) {
    throw new Error('Failed to insert user');
  }
  return row;
}

export async function findUserByUsername(
  username: string,
  client?: PoolClient,
): Promise<UserRow | null> {
  const executor = client ?? getPool();
  const res = await executor.query<UserRow>(
    `SELECT * FROM users WHERE username = $1 AND deleted_at IS NULL`,
    [username],
  );
  return res.rows[0] ?? null;
}

export async function findUserById(
  id: string,
  client?: PoolClient,
): Promise<UserRow | null> {
  const executor = client ?? getPool();
  const res = await executor.query<UserRow>(
    `SELECT * FROM users WHERE id = $1`,
    [id],
  );
  return res.rows[0] ?? null;
}
