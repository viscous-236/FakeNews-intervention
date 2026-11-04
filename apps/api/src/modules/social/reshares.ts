/** Reshare creation and retraction (RUL-019, DEC-003, DEC-005). */

import { type PoolClient } from '../../db/pool.js';
import { withTransaction } from '../../db/tx.js';
import { AppError } from '../../middleware/errors.js';
import { emitNotification } from '../notifications/bus.js';
import { insertNotification } from '../notifications/repo.js';
import { toNotificationItem, type NotificationItem } from '../notifications/service.js';
import { tierOfValue } from '../../scoring/tier.js';
import { findPostById, insertPost, softDeletePostRow } from '../posts/repo.js';
import { serializePost, type PostOutput } from '../posts/service.js';
import { retractReshareEventOnDelete, syncReshareEventOnCreate } from '../../scoring/events.js';
import type { ReshareInput } from '@app/shared';

async function assertNotBlocked(tx: PoolClient, userId: string, authorId: string): Promise<void> {
  const result = await tx.query(
    `SELECT 1 FROM blocks
      WHERE (blocker_id = $1 AND blocked_id = $2)
         OR (blocker_id = $2 AND blocked_id = $1)`,
    [userId, authorId],
  );
  if (result.rows[0]) {
    throw new AppError(404, 'NOT_FOUND', 'Post not found');
  }
}

export async function createReshare(
  user: { id: string; q: string | number; role: 'user' | 'admin' },
  originalPostId: string,
  input: ReshareInput,
): Promise<PostOutput> {
  let notificationTarget: string | null = null;
  let pendingNotification: NotificationItem | null = null;
  const result = await withTransaction(async (tx) => {
    const original = await findPostById(originalPostId, tx);
    if (
      !original ||
      original.kind !== 'original' ||
      original.status === 'deleted' ||
      original.deleted_at
    ) {
      throw new AppError(404, 'NOT_FOUND', 'Post not found');
    }
    if (original.status === 'held') {
      throw new AppError(404, 'NOT_FOUND', 'Post not found');
    }
    await assertNotBlocked(tx, user.id, original.author_id);

    const publicStatus = await tx.query<{ label: string }>(
      `SELECT label FROM post_public_status_v WHERE post_id = $1`,
      [original.id],
    );
    const label = publicStatus.rows[0]?.label ?? 'none';
    const authorTier = tierOfValue(original.author_q);
    const requiresWarning =
      label === 'auto_flagged' || label === 'fact_checked_false' || authorTier === 'low';
    if (requiresWarning && !input.acknowledgedWarning) {
      throw new AppError(
        409,
        'CONFIRMATION_REQUIRED',
        'Acknowledgement is required before resharing this post',
      );
    }

    const existing = await tx.query<{ id: string }>(
      `SELECT id FROM posts
        WHERE author_id = $1 AND reshare_of_post_id = $2 AND kind = 'reshare' AND status <> 'deleted'
        FOR UPDATE`,
      [user.id, original.id],
    );
    if (existing.rows[0]) {
      throw new AppError(409, 'ALREADY_EXISTS', 'You already reshared this post');
    }

    const reshare = await insertPost(
      {
        authorId: user.id,
        kind: 'reshare',
        reshareOfPostId: original.id,
        body: input.comment ?? '',
        status: 'published',
        authorTier: tierOfValue(user.q),
      },
      tx,
    );
    await syncReshareEventOnCreate(tx, {
      id: reshare.id,
      author_id: reshare.author_id,
      reshare_of_post_id: reshare.reshare_of_post_id!,
    });
    notificationTarget = original.author_id === user.id ? null : original.author_id;
    if (notificationTarget) {
      const row = await insertNotification(
        { userId: notificationTarget, actorId: user.id, type: 'reshare', postId: originalPostId },
        tx,
      );
      pendingNotification = toNotificationItem(row);
    }
    return serializePost(reshare, { id: user.id, role: user.role }, false, tx);
  });

  if (notificationTarget && pendingNotification)
    emitNotification(notificationTarget, pendingNotification);
  return result;
}

export async function deleteReshare(userId: string, targetId: string): Promise<void> {
  await withTransaction(async (tx) => {
    const target = await findPostById(targetId, tx);
    let reshareId: string | undefined;
    let originalId: string | undefined;

    if (target?.kind === 'original') {
      originalId = target.id;
      const result = await tx.query<{ id: string }>(
        `SELECT id FROM posts
          WHERE author_id = $1 AND reshare_of_post_id = $2 AND kind = 'reshare'
            AND status <> 'deleted'
          FOR UPDATE`,
        [userId, target.id],
      );
      reshareId = result.rows[0]?.id;
    } else if (
      target?.kind === 'reshare' &&
      target.author_id === userId &&
      target.reshare_of_post_id
    ) {
      reshareId = target.id;
      originalId = target.reshare_of_post_id;
    }

    if (!reshareId || !originalId) return;
    await softDeletePostRow(reshareId, tx);
    await retractReshareEventOnDelete(tx, userId, originalId);
  });
}
