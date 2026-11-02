/** Comments are persisted social data and never scoring events. */

import { withTransaction } from '../../db/tx.js';
import { AppError } from '../../middleware/errors.js';
import { decodeCursor, encodeCursor } from '../../db/cursor.js';

export async function createComment(
  userId: string,
  postId: string,
  body: string,
): Promise<Record<string, unknown>> {
  return withTransaction(async (tx) => {
    const post = await tx.query<{ id: string; status: string }>(
      `SELECT id, status FROM posts WHERE id = $1 FOR SHARE`,
      [postId],
    );
    if (!post.rows[0] || post.rows[0].status === 'deleted') {
      throw new AppError(404, 'NOT_FOUND', 'Post not found');
    }
    const result = await tx.query<Record<string, unknown>>(
      `INSERT INTO comments (post_id, author_id, body)
       VALUES ($1, $2, $3)
       RETURNING id, post_id AS "postId", author_id AS "authorId", body, created_at AS "createdAt"`,
      [postId, userId, body],
    );
    const comment = result.rows[0];
    if (!comment) throw new AppError(500, 'INTERNAL', 'Comment was not created');
    return comment;
  });
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
): Promise<{ items: Record<string, unknown>[]; nextCursor: string | null }> {
  const decoded = cursor ? decodeCursor(cursor) : null;
  return withTransaction(async (tx) => {
    const result = await tx.query<Record<string, unknown> & { id: string; createdAt: Date }>(
      `SELECT c.id, c.post_id AS "postId", c.author_id AS "authorId",
              u.username, u.display_name AS "displayName", c.body,
              c.created_at AS "createdAt"
       FROM comments c
       JOIN users u ON u.id = c.author_id
       WHERE c.post_id = $1 AND c.deleted_at IS NULL
         AND ($2::timestamptz IS NULL OR (c.created_at, c.id) > ($2, $3))
       ORDER BY c.created_at ASC, c.id ASC
       LIMIT $4`,
      [postId, decoded?.createdAt ?? null, decoded?.id ?? null, limit + 1],
    );
    const hasMore = result.rows.length > limit;
    const items = hasMore ? result.rows.slice(0, limit) : result.rows;
    const last = items[items.length - 1];
    return {
      items,
      nextCursor: hasMore && last ? encodeCursor(new Date(last.createdAt), last.id) : null,
    };
  });
}
