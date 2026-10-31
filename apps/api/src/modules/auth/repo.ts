/**
 * apps/api/src/modules/auth/repo.ts (TASK-038)
 *
 * Repository functions for authentication and session management.
 */

import { type PoolClient } from '../../db/pool.js';
import { getPool } from '../../db/pool.js';
import { type UserRow } from '../users/repo.js';

export async function findUserByIdentifier(
  identifier: string,
  client?: PoolClient,
): Promise<UserRow | null> {
  const executor = client ?? getPool();
  const res = await executor.query<UserRow>(
    `SELECT * FROM users
     WHERE (lower(username) = lower($1) OR lower(email) = lower($1))
       AND deleted_at IS NULL`,
    [identifier.trim()],
  );
  return res.rows[0] ?? null;
}

export async function checkUsernameOrEmailTaken(
  username: string,
  email: string,
  client?: PoolClient,
): Promise<{ usernameTaken: boolean; emailTaken: boolean }> {
  const executor = client ?? getPool();
  const res = await executor.query<{ username: string; email: string }>(
    `SELECT username, email FROM users
     WHERE lower(username) = lower($1) OR lower(email) = lower($2)`,
    [username.trim(), email.trim()],
  );

  let usernameTaken = false;
  let emailTaken = false;

  for (const row of res.rows) {
    if (row.username.toLowerCase() === username.trim().toLowerCase()) {
      usernameTaken = true;
    }
    if (row.email.toLowerCase() === email.trim().toLowerCase()) {
      emailTaken = true;
    }
  }

  return { usernameTaken, emailTaken };
}

export async function createSession(
  userId: string,
  tokenHash: string,
  expiresAt: Date,
  userAgent: string | null,
  ip: string | null,
  client?: PoolClient,
): Promise<string> {
  const executor = client ?? getPool();
  const res = await executor.query<{ id: string }>(
    `INSERT INTO sessions (user_id, token_hash, expires_at, user_agent, ip)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [userId, tokenHash, expiresAt, userAgent, ip],
  );
  return res.rows[0]!.id;
}

export async function deleteSessionByTokenHash(
  tokenHash: string,
  client?: PoolClient,
): Promise<void> {
  const executor = client ?? getPool();
  await executor.query(`DELETE FROM sessions WHERE token_hash = $1`, [tokenHash]);
}

export async function createEmailToken(
  userId: string,
  purpose: 'verify_email' | 'reset_password',
  tokenHash: string,
  expiresAt: Date,
  client?: PoolClient,
): Promise<string> {
  const executor = client ?? getPool();
  const res = await executor.query<{ id: string }>(
    `INSERT INTO email_tokens (user_id, purpose, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [userId, purpose, tokenHash, expiresAt],
  );
  return res.rows[0]!.id;
}

export async function queueOutboxEmail(
  toEmail: string,
  subject: string,
  bodyText: string,
  client?: PoolClient,
): Promise<string> {
  const executor = client ?? getPool();
  const res = await executor.query<{ id: string }>(
    `INSERT INTO email_outbox (to_email, subject, body_text)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [toEmail, subject, bodyText],
  );
  return res.rows[0]!.id;
}
