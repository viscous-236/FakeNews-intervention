/** Follow and block lifecycle (RUL-028). */

import { withTransaction } from '../../db/tx.js';
import { AppError } from '../../middleware/errors.js';
import { emitNotification } from '../notifications/bus.js';
import { insertNotification } from '../notifications/repo.js';
import { toNotificationItem, type NotificationItem } from '../notifications/service.js';
import { findTargetUser } from './people.js';

async function assertNoBlock(
  tx: import('pg').PoolClient,
  userId: string,
  targetId: string,
): Promise<void> {
  const result = await tx.query(
    `SELECT 1 FROM blocks
      WHERE (blocker_id = $1 AND blocked_id = $2)
         OR (blocker_id = $2 AND blocked_id = $1)`,
    [userId, targetId],
  );
  // Section 1.7: NOT_FOUND is "also used when blocked" so the block stays private.
  if (result.rows[0]) {
    throw new AppError(404, 'NOT_FOUND', 'User not found');
  }
}

export async function followUser(userId: string, username: string): Promise<void> {
  let notificationTarget: string | null = null;
  let pendingNotification: NotificationItem | null = null;
  await withTransaction(async (tx) => {
    const target = await findTargetUser(username, tx);
    if (target.id === userId) {
      throw new AppError(400, 'VALIDATION_ERROR', 'You cannot follow yourself');
    }
    if (target.status !== 'active') {
      throw new AppError(404, 'NOT_FOUND', 'User not found');
    }
    await assertNoBlock(tx, userId, target.id);
    const result = await tx.query(
      `INSERT INTO follows (follower_id, followee_id)
       VALUES ($1, $2)
       ON CONFLICT (follower_id, followee_id) DO NOTHING
       RETURNING followee_id`,
      [userId, target.id],
    );
    if (!result.rows[0]) {
      throw new AppError(409, 'ALREADY_EXISTS', 'Already following this user');
    }
    notificationTarget = target.id;
    const row = await insertNotification(
      { userId: target.id, actorId: userId, type: 'new_follower' },
      tx,
    );
    pendingNotification = toNotificationItem(row);
  });

  if (notificationTarget && pendingNotification)
    emitNotification(notificationTarget, pendingNotification);
}

export async function unfollowUser(userId: string, username: string): Promise<void> {
  await withTransaction(async (tx) => {
    const target = await findTargetUser(username, tx);
    await tx.query(`DELETE FROM follows WHERE follower_id = $1 AND followee_id = $2`, [
      userId,
      target.id,
    ]);
  });
}

export async function blockUser(userId: string, username: string): Promise<void> {
  await withTransaction(async (tx) => {
    const target = await findTargetUser(username, tx);
    if (target.id === userId) {
      throw new AppError(400, 'VALIDATION_ERROR', 'You cannot block yourself');
    }
    await tx.query(
      `INSERT INTO blocks (blocker_id, blocked_id)
       VALUES ($1, $2)
       ON CONFLICT (blocker_id, blocked_id) DO NOTHING`,
      [userId, target.id],
    );
    await tx.query(
      `DELETE FROM follows
        WHERE (follower_id = $1 AND followee_id = $2)
           OR (follower_id = $2 AND followee_id = $1)`,
      [userId, target.id],
    );
  });
}

export async function unblockUser(userId: string, username: string): Promise<void> {
  await withTransaction(async (tx) => {
    const target = await findTargetUser(username, tx);
    await tx.query(`DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2`, [
      userId,
      target.id,
    ]);
  });
}
