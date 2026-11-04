/** Comments are persisted social data and never scoring events (DEC-006). */

import { type PoolClient } from '../../db/pool.js';
import { withTransaction } from '../../db/tx.js';
import { AppError } from '../../middleware/errors.js';
import { decodeCursor, encodeCursor } from '../../db/cursor.js';
import { emitNotification } from '../notifications/bus.js';
import { insertNotification } from '../notifications/repo.js';
import { toNotificationItem, type NotificationItem } from '../notifications/service.js';
import { toUserSummary } from './people.js';
import { type UserSummary } from '../users/service.js';

export interface CommentItem {
  id: string;
  postId: string;
  author: UserSummary;
  body: string;
  createdAt: string;
}

interface CommentJoinedRow {
  id: string;
  post_id: string;
  body: string;
  created_at: Date;
  author_id: string;
  username: string;
  display_name: string;
  avatar_media_id: string | null;
  q: string;
  author_created_at: Date;
}

const COMMENT_SELECT = `
  SELECT c.id, c.post_id, c.body, c.created_at,
         u.id AS author_id, u.username, u.display_name, u.avatar_media_id, u.q,
         u.created_at AS author_created_at
    FROM comments c
    JOIN users u ON u.id = c.author_id`;

function toCommentItem(row: CommentJoinedRow): CommentItem {
  return {
    id: row.id,
    postId: row.post_id,
    author: toUserSummary({
      id: row.author_id,
      username: row.username,
      display_name: row.display_name,
      avatar_media_id: row.avatar_media_id,
      q: row.q,
      created_at: row.author_created_at,
    }),
    body: row.body,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

async function assertNotBlocked(tx: PoolClient, userId: string, authorId: string): Promise<void> {
  const blocked = await tx.query(
    `SELECT 1 FROM blocks
      WHERE (blocker_id = $1 AND blocked_id = $2)
         OR (blocker_id = $2 AND blocked_id = $1)`,
    [userId, authorId],
  );
  // RUL-028: a blocked relationship makes the post invisible to the other side.
  if (blocked.rows[0]) throw new AppError(404, 'NOT_FOUND', 'Post not found');
}

export async function createComment(
  userId: string,
  postId: string,
  body: string,
  isAdmin = false,
): Promise<CommentItem> {
  let notificationTarget: string | null = null;
  let pendingNotification: NotificationItem | null = null;
  const comment = await withTransaction(async (tx) => {
    const post = await tx.query<{ id: string; author_id: string; status: string }>(
      `SELECT id, author_id, status FROM posts WHERE id = $1 FOR SHARE`,
      [postId],
    );
    const target = post.rows[0];
    if (!target || target.status === 'deleted') {
      throw new AppError(404, 'NOT_FOUND', 'Post not found');
    }
    // RUL-024: held posts are visible only to their author and administrators.
    if (target.status === 'held' && target.author_id !== userId && !isAdmin) {
      throw new AppError(404, 'NOT_FOUND', 'Post not found');
    }
    if (target.author_id !== userId) await assertNotBlocked(tx, userId, target.author_id);

    const inserted = await tx.query<{ id: string }>(
      `INSERT INTO comments (post_id, author_id, body) VALUES ($1, $2, $3) RETURNING id`,
      [postId, userId, body],
    );
    const commentId = inserted.rows[0]?.id;
    if (!commentId) throw new AppError(500, 'INTERNAL', 'Comment was not created');
    const joined = await tx.query<CommentJoinedRow>(`${COMMENT_SELECT} WHERE c.id = $1`, [
      commentId,
    ]);
    const row = joined.rows[0];
    if (!row) throw new AppError(500, 'INTERNAL', 'Comment was not created');

    notificationTarget = target.author_id === userId ? null : target.author_id;
    if (notificationTarget) {
      const notificationRow = await insertNotification(
        { userId: notificationTarget, actorId: userId, type: 'comment', postId },
        tx,
      );
      pendingNotification = toNotificationItem(notificationRow);
    }
    return toCommentItem(row);
  });

  if (pendingNotification && notificationTarget)
    emitNotification(notificationTarget, pendingNotification);
  return comment;
}

export async function deleteComment(
  commentId: string,
  userId: string,
  isAdmin: boolean,
): Promise<void> {
  await withTransaction(async (tx) => {
    const result = await tx.query<{ author_id: string }>(
      `SELECT author_id FROM comments WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [commentId],
    );
    const comment = result.rows[0];
    if (!comment) throw new AppError(404, 'NOT_FOUND', 'Comment not found');
    if (!isAdmin && comment.author_id !== userId) {
      throw new AppError(403, 'FORBIDDEN', 'Cannot delete another user comment');
    }
    await tx.query(`UPDATE comments SET deleted_at = now() WHERE id = $1`, [commentId]);
  });
}

export async function listComments(
  postId: string,
  cursor: string | undefined,
  limit: number,
): Promise<{ items: CommentItem[]; nextCursor: string | null }> {
  const decoded = cursor ? decodeCursor(cursor) : null;
  return withTransaction(async (tx) => {
    const result = await tx.query<CommentJoinedRow>(
      `${COMMENT_SELECT}
       WHERE c.post_id = $1 AND c.deleted_at IS NULL
         AND ($2::timestamptz IS NULL OR (c.created_at, c.id) > ($2, $3))
       ORDER BY c.created_at ASC, c.id ASC
       LIMIT $4`,
      [postId, decoded?.createdAt ?? null, decoded?.id ?? null, limit + 1],
    );
    const hasMore = result.rows.length > limit;
    const rows = hasMore ? result.rows.slice(0, limit) : result.rows;
    const last = rows[rows.length - 1];
    return {
      items: rows.map(toCommentItem),
      nextCursor: hasMore && last ? encodeCursor(new Date(last.created_at), last.id) : null,
    };
  });
}
