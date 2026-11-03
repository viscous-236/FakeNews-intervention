/** Like lifecycle and its optional misinformation penalty. */

import { withTransaction } from '../../db/tx.js';
import { AppError } from '../../middleware/errors.js';
import { emitNotification } from '../notifications/bus.js';
import { insertNotification } from '../notifications/repo.js';
import { toNotificationItem, type NotificationItem } from '../notifications/service.js';
import { retractLikeEventOnUnlike, syncLikeEventOnLike } from '../../scoring/events.js';

export async function likePost(userId: string, postId: string): Promise<void> {
  let notificationTarget: string | null = null;
  let pendingNotification: NotificationItem | null = null;
  await withTransaction(async (tx) => {
    const postResult = await tx.query<{ author_id: string; kind: string; status: string }>(
      `SELECT author_id, kind, status FROM posts WHERE id = $1 FOR SHARE`,
      [postId],
    );
    const post = postResult.rows[0];
    if (!post || post.status === 'deleted') throw new AppError(404, 'NOT_FOUND', 'Post not found');
    if (post.kind !== 'original') {
      throw new AppError(400, 'INVALID_TARGET', 'Likes are allowed only on original posts');
    }

    const existing = await tx.query<{ deleted_at: Date | null }>(
      `SELECT deleted_at FROM likes WHERE user_id = $1 AND post_id = $2 FOR UPDATE`,
      [userId, postId],
    );
    if (existing.rows[0] && existing.rows[0].deleted_at === null) return;

    await tx.query(
      `INSERT INTO likes (user_id, post_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, post_id)
       DO UPDATE SET deleted_at = NULL, updated_at = now()`,
      [userId, postId],
    );
    await syncLikeEventOnLike(tx, userId, postId);
    if (post.author_id !== userId) {
      notificationTarget = post.author_id;
      const row = await insertNotification(
        { userId: post.author_id, actorId: userId, type: 'like', postId },
        tx,
      );
      pendingNotification = toNotificationItem(row);
    }
  });

  if (notificationTarget && pendingNotification) emitNotification(notificationTarget, pendingNotification);
}

export async function unlikePost(userId: string, postId: string): Promise<void> {
  await withTransaction(async (tx) => {
    const result = await tx.query<{ post_id: string }>(
      `UPDATE likes SET deleted_at = now(), updated_at = now()
       WHERE user_id = $1 AND post_id = $2 AND deleted_at IS NULL
       RETURNING post_id`,
      [userId, postId],
    );
    if (!result.rows[0]) return;
    await retractLikeEventOnUnlike(tx, userId, postId);
  });
}
