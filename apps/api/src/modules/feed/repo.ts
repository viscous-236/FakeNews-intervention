/**
 * apps/api/src/modules/feed/repo.ts (TASK-044, RUL-028, RUL-031)
 *
 * Repository for global feed and following feed queries with keyset cursor pagination.
 */

import { type PoolClient } from '../../db/pool.js';
import { getPool } from '../../db/pool.js';
import { type DecodedCursor } from '../../db/cursor.js';
import { type PostAuthorJoinedRow } from '../posts/repo.js';

export interface FeedQueryOptions {
  cursor?: DecodedCursor | null;
  limit: number;
  viewerId?: string;
}

export async function findGlobalFeed(
  options: FeedQueryOptions,
  client?: PoolClient,
): Promise<PostAuthorJoinedRow[]> {
  const executor = client ?? getPool();
  const limitPlusOne = options.limit + 1;

  const cursorCreatedAt = options.cursor ? options.cursor.createdAt : null;
  const cursorId = options.cursor ? options.cursor.id : null;
  const viewerId = options.viewerId ?? null;

  const res = await executor.query<PostAuthorJoinedRow>(
    `SELECT
       p.*,
       u.username AS author_username,
       u.display_name AS author_display_name,
       u.avatar_media_id AS author_avatar_media_id,
       u.q AS author_q
     FROM posts p
     JOIN users u ON u.id = p.author_id
     WHERE p.status = 'published' AND p.deleted_at IS NULL
       AND (
         $1::timestamptz IS NULL
         OR (p.created_at, p.id) < ($1, $2::uuid)
       )
       AND (
         $3::uuid IS NULL
         OR NOT EXISTS (
           SELECT 1 FROM blocks b
           WHERE (b.blocker_id = $3 AND b.blocked_id = p.author_id)
              OR (b.blocker_id = p.author_id AND b.blocked_id = $3)
         )
       )
     ORDER BY p.created_at DESC, p.id DESC
     LIMIT $4`,
    [cursorCreatedAt, cursorId, viewerId, limitPlusOne],
  );

  return res.rows;
}

export async function findFollowingFeed(
  options: FeedQueryOptions & { viewerId: string },
  client?: PoolClient,
): Promise<PostAuthorJoinedRow[]> {
  const executor = client ?? getPool();
  const limitPlusOne = options.limit + 1;

  const cursorCreatedAt = options.cursor ? options.cursor.createdAt : null;
  const cursorId = options.cursor ? options.cursor.id : null;

  const res = await executor.query<PostAuthorJoinedRow>(
    `SELECT
       p.*,
       u.username AS author_username,
       u.display_name AS author_display_name,
       u.avatar_media_id AS author_avatar_media_id,
       u.q AS author_q
     FROM posts p
     JOIN users u ON u.id = p.author_id
     WHERE p.status = 'published' AND p.deleted_at IS NULL
       AND (
         p.author_id = $3
         OR EXISTS (
           SELECT 1 FROM follows f
           WHERE f.follower_id = $3 AND f.followee_id = p.author_id
         )
       )
       AND (
         $1::timestamptz IS NULL
         OR (p.created_at, p.id) < ($1, $2::uuid)
       )
       AND NOT EXISTS (
         SELECT 1 FROM blocks b
         WHERE (b.blocker_id = $3 AND b.blocked_id = p.author_id)
            OR (b.blocker_id = p.author_id AND b.blocked_id = $3)
       )
     ORDER BY p.created_at DESC, p.id DESC
     LIMIT $4`,
    [cursorCreatedAt, cursorId, options.viewerId, limitPlusOne],
  );

  return res.rows;
}
