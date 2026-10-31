/**
 * apps/api/src/modules/auth/repo.ts (TASK-038, TASK-039)
 *
 * Repository functions for authentication, tokens, and session management.
 */

import { type PoolClient } from '../../db/pool.js';
import { getPool } from '../../db/pool.js';
import { type UserRow } from '../users/repo.js';

export interface EmailTokenRow {
  id: string;
  user_id: string;
  purpose: 'verify_email' | 'reset_password';
  token_hash: string;
  expires_at: Date;
  used_at: Date | null;
  created_at: Date;
}

export interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  created_at: Date;
  expires_at: Date;
  last_seen_at: Date;
  user_agent: string | null;
  ip: string | null;
}

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

export async function findEmailTokenByHash(
  tokenHash: string,
  purpose: 'verify_email' | 'reset_password',
  client?: PoolClient,
): Promise<EmailTokenRow | null> {
  const executor = client ?? getPool();
  const res = await executor.query<EmailTokenRow>(
    `SELECT * FROM email_tokens
     WHERE token_hash = $1 AND purpose = $2`,
    [tokenHash, purpose],
  );
  return res.rows[0] ?? null;
}

export async function markEmailTokenUsed(
  id: string,
  client?: PoolClient,
): Promise<void> {
  const executor = client ?? getPool();
  await executor.query(
    `UPDATE email_tokens SET used_at = now() WHERE id = $1`,
    [id],
  );
}

export async function setUserEmailVerified(
  userId: string,
  client?: PoolClient,
): Promise<void> {
  const executor = client ?? getPool();
  await executor.query(
    `UPDATE users SET email_verified_at = now(), updated_at = now() WHERE id = $1`,
    [userId],
  );
}

export async function updateUserPassword(
  userId: string,
  passwordHash: string,
  client?: PoolClient,
): Promise<void> {
  const executor = client ?? getPool();
  await executor.query(
    `UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2`,
    [passwordHash, userId],
  );
}

export async function deleteAllUserSessions(
  userId: string,
  client?: PoolClient,
): Promise<void> {
  const executor = client ?? getPool();
  await executor.query(
    `DELETE FROM sessions WHERE user_id = $1`,
    [userId],
  );
}

export async function deleteUserSessionsExcept(
  userId: string,
  keepSessionId: string,
  client?: PoolClient,
): Promise<void> {
  const executor = client ?? getPool();
  await executor.query(
    `DELETE FROM sessions WHERE user_id = $1 AND id <> $2`,
    [userId, keepSessionId],
  );
}

export async function findUserSessions(
  userId: string,
  client?: PoolClient,
): Promise<SessionRow[]> {
  const executor = client ?? getPool();
  const res = await executor.query<SessionRow>(
    `SELECT id, user_id, token_hash, created_at, expires_at, last_seen_at, user_agent, ip
     FROM sessions
     WHERE user_id = $1 AND expires_at > now()
     ORDER BY created_at DESC`,
    [userId],
  );
  return res.rows;
}

export async function deleteSessionById(
  sessionId: string,
  userId: string,
  client?: PoolClient,
): Promise<boolean> {
  const executor = client ?? getPool();
  const res = await executor.query(
    `DELETE FROM sessions WHERE id = $1 AND user_id = $2`,
    [sessionId, userId],
  );
  return (res.rowCount ?? 0) > 0;
}
