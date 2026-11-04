/** PostgreSQL full-text post and trigram user search (RUL-030). */

import { getPool } from '../../db/pool.js';
import { decodeCursor, encodeCursor } from '../../db/cursor.js';
import { serializePost, type PostOutput } from '../posts/service.js';
import { type PostAuthorJoinedRow } from '../posts/repo.js';
import { toUserSummary, type UserPage } from '../social/people.js';
import { type UserSummary } from '../users/service.js';

interface SearchPostRow extends PostAuthorJoinedRow {
  search_rank: number;
}

interface SearchUserRow {
  id: string;
  username: string;
  display_name: string;
  avatar_media_id: string | null;
  q: string;
  created_at: Date;
  search_rank: number;
}

export async function searchPosts(
  query: string,
  cursor: string | undefined,
  limit: number,
  viewer?: { id: string; role: 'user' | 'admin' },
): Promise<{ items: PostOutput[]; nextCursor: string | null }> {
  const decoded = cursor ? decodeCursor(cursor) : null;
  const result = await getPool().query<SearchPostRow>(
    `WITH search AS (
       SELECT p.*, u.username AS author_username,
              u.display_name AS author_display_name,
              u.avatar_media_id AS author_avatar_media_id,
              u.q AS author_q,
              ts_rank(p.body_tsv, websearch_to_tsquery('english', $1)) AS search_rank
         FROM posts p
         JOIN users u ON u.id = p.author_id
        WHERE p.kind = 'original' AND p.status = 'published' AND p.deleted_at IS NULL
          AND u.status <> 'deleted' AND u.deleted_at IS NULL
          AND p.body_tsv @@ websearch_to_tsquery('english', $1)
          AND ($5::uuid IS NULL OR NOT EXISTS (
            SELECT 1 FROM blocks b
             WHERE (b.blocker_id = $5 AND b.blocked_id = p.author_id)
                OR (b.blocker_id = p.author_id AND b.blocked_id = $5)
          ))
     )
     SELECT * FROM search
      WHERE $2::timestamptz IS NULL
         OR search_rank < COALESCE((SELECT search_rank FROM search WHERE id = $4::uuid), -1)
         OR (
           search_rank = (SELECT search_rank FROM search WHERE id = $4::uuid)
           AND (created_at, id) < ($2, $3::uuid)
         )
      ORDER BY search_rank DESC, created_at DESC, id DESC
      LIMIT $6`,
    [
      query,
      decoded?.createdAt ?? null,
      decoded?.id ?? null,
      decoded?.id ?? null,
      viewer?.id ?? null,
      limit + 1,
    ],
  );

  const hasMore = result.rows.length > limit;
  const rows = hasMore ? result.rows.slice(0, limit) : result.rows;
  const items = await Promise.all(rows.map((row) => serializePost(row, viewer)));
  const last = rows.at(-1);
  return {
    items,
    nextCursor: hasMore && last ? encodeCursor(new Date(last.created_at), last.id) : null,
  };
}

export async function searchUsers(
  query: string,
  cursor: string | undefined,
  limit: number,
  viewerId?: string,
): Promise<UserPage> {
  const decoded = cursor ? decodeCursor(cursor) : null;
  const result = await getPool().query<SearchUserRow>(
    `WITH search AS (
       SELECT u.id, u.username, u.display_name, u.avatar_media_id, u.q, u.created_at,
              similarity(u.display_name, $1) AS search_rank
         FROM users u
        WHERE u.status <> 'deleted' AND u.deleted_at IS NULL
          AND (u.username ILIKE $1 || '%' OR similarity(u.display_name, $1) > 0.3)
          AND ($4::uuid IS NULL OR NOT EXISTS (
            SELECT 1 FROM blocks b
             WHERE (b.blocker_id = $4 AND b.blocked_id = u.id)
                OR (b.blocker_id = u.id AND b.blocked_id = $4)
          ))
     )
     SELECT * FROM search
      WHERE $2::timestamptz IS NULL
         OR search_rank < COALESCE((SELECT search_rank FROM search WHERE id = $3::uuid), -1)
         OR (
           search_rank = (SELECT search_rank FROM search WHERE id = $3::uuid)
           AND (created_at, id) < ($2, $3::uuid)
         )
      ORDER BY search_rank DESC, created_at DESC, id DESC
      LIMIT $5`,
    [query, decoded?.createdAt ?? null, decoded?.id ?? null, viewerId ?? null, limit + 1],
  );
  const hasMore = result.rows.length > limit;
  const rows = hasMore ? result.rows.slice(0, limit) : result.rows;
  const last = rows.at(-1);
  return {
    items: rows.map(toUserSummary),
    nextCursor: hasMore && last ? encodeCursor(new Date(last.created_at), last.id) : null,
  };
}

export type { UserSummary };
