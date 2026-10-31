/**
 * apps/api/src/modules/users/repo.ts (TASK-016, TASK-040)
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

export interface UserCounts {
  posts: number;
  followers: number;
  following: number;
}

export async function getUserCounts(
  userId: string,
  client?: PoolClient,
): Promise<UserCounts> {
  const executor = client ?? getPool();
  const res = await executor.query<{
    posts: string;
    followers: string;
    following: string;
  }>(
    `SELECT
      (SELECT count(*) FROM posts WHERE author_id = $1 AND deleted_at IS NULL AND status = 'published') AS posts,
      (SELECT count(*) FROM follows WHERE followee_id = $1) AS followers,
      (SELECT count(*) FROM follows WHERE follower_id = $1) AS following`,
    [userId],
  );
  const row = res.rows[0];
  return {
    posts: parseInt(row?.posts ?? '0', 10),
    followers: parseInt(row?.followers ?? '0', 10),
    following: parseInt(row?.following ?? '0', 10),
  };
}

export interface ViewerRelationship {
  following: boolean;
  blocked: boolean;
}

export async function getViewerRelationship(
  viewerId: string,
  targetId: string,
  client?: PoolClient,
): Promise<ViewerRelationship> {
  const executor = client ?? getPool();
  const res = await executor.query<{
    is_following: boolean;
    is_blocked: boolean;
  }>(
    `SELECT
      EXISTS(SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = $2) AS is_following,
      EXISTS(SELECT 1 FROM blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)) AS is_blocked`,
    [viewerId, targetId],
  );
  const row = res.rows[0];
  return {
    following: Boolean(row?.is_following),
    blocked: Boolean(row?.is_blocked),
  };
}

export async function checkMediaExists(
  mediaId: string,
  client?: PoolClient,
): Promise<boolean> {
  const executor = client ?? getPool();
  const res = await executor.query<{ exists: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM media WHERE id = $1) AS exists`,
    [mediaId],
  );
  return Boolean(res.rows[0]?.exists);
}

export async function updateUserProfile(
  userId: string,
  updates: {
    displayName?: string;
    bio?: string;
    avatarMediaId?: string | null;
  },
  client?: PoolClient,
): Promise<UserRow> {
  const executor = client ?? getPool();
  const setClauses: string[] = ['updated_at = now()'];
  const values: unknown[] = [];
  let idx = 1;

  if (updates.displayName !== undefined) {
    setClauses.push(`display_name = $${idx++}`);
    values.push(updates.displayName);
  }
  if (updates.bio !== undefined) {
    setClauses.push(`bio = $${idx++}`);
    values.push(updates.bio);
  }
  if (updates.avatarMediaId !== undefined) {
    setClauses.push(`avatar_media_id = $${idx++}`);
    values.push(updates.avatarMediaId);
  }

  values.push(userId);
  const sql = `
    UPDATE users
    SET ${setClauses.join(', ')}
    WHERE id = $${idx}
    RETURNING *
  `;
  const res = await executor.query<UserRow>(sql, values);
  const row = res.rows[0];
  if (!row) {
    throw new Error('User not found');
  }
  return row;
}
