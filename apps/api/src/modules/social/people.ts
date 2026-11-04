/** Follow, block, connection-list, and suggestion queries (RUL-028, RUL-029). */

import { type PoolClient } from '../../db/pool.js';
import { getPool } from '../../db/pool.js';
import { decodeCursor, encodeCursor, type DecodedCursor } from '../../db/cursor.js';
import { AppError } from '../../middleware/errors.js';
import { config } from '../../config.js';
import { tierOfValue } from '../../scoring/tier.js';
import { type UserSummary } from '../users/service.js';

interface UserRow {
  id: string;
  username: string;
  display_name: string;
  avatar_media_id: string | null;
  q: string;
  created_at: Date;
}

export interface UserPage {
  items: UserSummary[];
  nextCursor: string | null;
}

export function toUserSummary(row: UserRow): UserSummary {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_media_id ? `${config.S3_PUBLIC_BASE_URL}/${row.avatar_media_id}` : null,
    tier: tierOfValue(row.q),
  };
}

async function findActionTarget(
  username: string,
  client?: PoolClient,
): Promise<{ id: string; status: string }> {
  const executor = client ?? getPool();
  const result = await executor.query<{ id: string; status: string }>(
    `SELECT id, status FROM users WHERE username = $1 AND deleted_at IS NULL`,
    [username],
  );
  const target = result.rows[0];
  if (!target || target.status === 'deleted') {
    throw new AppError(404, 'NOT_FOUND', 'User not found');
  }
  return target;
}

export async function findTargetUser(
  username: string,
  client?: PoolClient,
): Promise<{ id: string; status: string }> {
  return findActionTarget(username, client);
}

export async function listConnections(
  username: string,
  direction: 'followers' | 'following',
  viewerId: string | undefined,
  cursor: string | undefined,
  limit: number,
): Promise<UserPage> {
  const target = await findActionTarget(username);
  const decoded = cursor ? decodeCursor(cursor) : null;
  const executor = getPool();
  const relationColumn = direction === 'followers' ? 'follower_id' : 'followee_id';
  const joinColumn = direction === 'followers' ? 'followee_id' : 'follower_id';
  const result = await executor.query<UserRow & { relation_created_at: Date }>(
    `SELECT u.id, u.username, u.display_name, u.avatar_media_id, u.q,
            f.created_at AS relation_created_at, u.created_at
       FROM follows f
       JOIN users u ON u.id = f.${relationColumn}
      WHERE f.${joinColumn} = $1
        AND u.status <> 'deleted' AND u.deleted_at IS NULL
        AND ($2::uuid IS NULL OR NOT EXISTS (
          SELECT 1 FROM blocks b
           WHERE (b.blocker_id = $2 AND b.blocked_id = u.id)
              OR (b.blocker_id = u.id AND b.blocked_id = $2)
        ))
        AND ($3::timestamptz IS NULL OR (f.created_at, u.id) < ($3, $4::uuid))
      ORDER BY f.created_at DESC, u.id DESC
      LIMIT $5`,
    [target.id, viewerId ?? null, decoded?.createdAt ?? null, decoded?.id ?? null, limit + 1],
  );
  const hasMore = result.rows.length > limit;
  const rows = hasMore ? result.rows.slice(0, limit) : result.rows;
  const last = rows.at(-1);
  return {
    items: rows.map(toUserSummary),
    nextCursor: hasMore && last ? encodeCursor(new Date(last.relation_created_at), last.id) : null,
  };
}

export async function listBlockedUsers(
  viewerId: string,
  cursor: string | undefined,
  limit: number,
): Promise<UserPage> {
  const decoded: DecodedCursor | null = cursor ? decodeCursor(cursor) : null;
  const result = await getPool().query<UserRow & { relation_created_at: Date }>(
    `SELECT u.id, u.username, u.display_name, u.avatar_media_id, u.q,
            b.created_at AS relation_created_at, u.created_at
       FROM blocks b
       JOIN users u ON u.id = b.blocked_id
      WHERE b.blocker_id = $1 AND u.status <> 'deleted' AND u.deleted_at IS NULL
        AND ($2::timestamptz IS NULL OR (b.created_at, u.id) < ($2, $3::uuid))
      ORDER BY b.created_at DESC, u.id DESC
      LIMIT $4`,
    [viewerId, decoded?.createdAt ?? null, decoded?.id ?? null, limit + 1],
  );
  const hasMore = result.rows.length > limit;
  const rows = hasMore ? result.rows.slice(0, limit) : result.rows;
  const last = rows.at(-1);
  return {
    items: rows.map(toUserSummary),
    nextCursor: hasMore && last ? encodeCursor(new Date(last.relation_created_at), last.id) : null,
  };
}

export async function getSuggestions(viewerId: string): Promise<{ items: UserSummary[] }> {
  const candidates = await getPool().query<UserRow & { mutual_count: string }>(
    `SELECT u.id, u.username, u.display_name, u.avatar_media_id, u.q, u.created_at,
            count(*)::int AS mutual_count
       FROM follows mine
       JOIN follows candidate ON candidate.follower_id = mine.followee_id
       JOIN users u ON u.id = candidate.followee_id
      WHERE mine.follower_id = $1
        AND u.id <> $1 AND u.status = 'active' AND u.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM follows existing
           WHERE existing.follower_id = $1 AND existing.followee_id = u.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM blocks b
           WHERE (b.blocker_id = $1 AND b.blocked_id = u.id)
              OR (b.blocker_id = u.id AND b.blocked_id = $1)
        )
      GROUP BY u.id
      ORDER BY mutual_count DESC, u.created_at DESC, u.id DESC
      LIMIT 10`,
    [viewerId],
  );

  const selected = candidates.rows.map(toUserSummary);
  if (selected.length >= 10) return { items: selected };

  const fallback = await getPool().query<UserRow>(
    `SELECT u.id, u.username, u.display_name, u.avatar_media_id, u.q, u.created_at
       FROM users u
      WHERE u.id <> $1 AND u.status = 'active' AND u.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM follows f
           WHERE f.follower_id = $1 AND f.followee_id = u.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM blocks b
           WHERE (b.blocker_id = $1 AND b.blocked_id = u.id)
              OR (b.blocker_id = u.id AND b.blocked_id = $1)
        )
        AND NOT (u.id = ANY($2::uuid[]))
      ORDER BY (SELECT count(*) FROM follows f WHERE f.followee_id = u.id) DESC,
               u.created_at DESC, u.id DESC
      LIMIT $3`,
    [viewerId, candidates.rows.map((row) => row.id), 10 - selected.length],
  );

  return { items: [...selected, ...fallback.rows.map(toUserSummary)] };
}
