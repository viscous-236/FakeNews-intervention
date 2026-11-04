/** Direct-message domain rules and realtime effects (REQ-042). */

import { type PoolClient } from '../../db/pool.js';
import { withTransaction } from '../../db/tx.js';
import { decodeCursor, encodeCursor } from '../../db/cursor.js';
import { config } from '../../config.js';
import { AppError } from '../../middleware/errors.js';
import { findUserByUsername } from '../users/repo.js';
import { tierOfValue } from '../../scoring/tier.js';
import { insertNotification } from '../notifications/repo.js';
import { toNotificationItem, type NotificationItem } from '../notifications/service.js';
import { emitNotification } from '../notifications/bus.js';
import { sendToUser } from '../../realtime/hub.js';
import {
  findConversationMessages,
  findConversations,
  insertMessage,
  markConversationRead,
  type ConversationRow,
  type MessageRow,
} from './repo.js';

export interface MessageItem {
  id: string;
  senderId: string;
  recipientId: string;
  body: string;
  createdAt: string;
  readAt: string | null;
}

function toMessageItem(row: MessageRow): MessageItem {
  return {
    id: row.id,
    senderId: row.sender_id,
    recipientId: row.recipient_id,
    body: row.body,
    createdAt: new Date(row.created_at).toISOString(),
    readAt: row.read_at ? new Date(row.read_at).toISOString() : null,
  };
}

function toConversationItem(row: ConversationRow) {
  return {
    user: {
      id: row.other_id,
      username: row.other_username,
      displayName: row.other_display_name,
      avatarUrl: row.other_avatar_media_id
        ? `${config.S3_PUBLIC_BASE_URL}/${row.other_avatar_media_id}`
        : null,
      tier: tierOfValue(row.other_q),
    },
    lastMessage: toMessageItem(row),
    unreadCount: Number(row.unread_count),
  };
}

async function findMessageTarget(username: string, client?: PoolClient) {
  const user = await findUserByUsername(username, client);
  if (!user || user.status !== 'active' || user.deleted_at !== null) {
    throw new AppError(404, 'NOT_FOUND', 'User not found');
  }
  return user;
}

async function assertMessagingAllowed(
  tx: PoolClient,
  userId: string,
  targetId: string,
): Promise<void> {
  const blocked = await tx.query(
    `SELECT 1 FROM blocks
      WHERE (blocker_id = $1 AND blocked_id = $2)
         OR (blocker_id = $2 AND blocked_id = $1)`,
    [userId, targetId],
  );
  // Section 1.7: NOT_FOUND is "also used when blocked" so the block stays private.
  if (blocked.rows[0]) throw new AppError(404, 'NOT_FOUND', 'User not found');
}

export async function listConversations(userId: string, cursor: string | undefined, limit: number) {
  const rows = await findConversations(userId, cursor ? decodeCursor(cursor) : null, limit);
  const hasMore = rows.length > limit;
  const items = (hasMore ? rows.slice(0, limit) : rows).map(toConversationItem);
  const last = hasMore ? rows[limit - 1] : undefined;
  return {
    items,
    nextCursor: last ? encodeCursor(new Date(last.created_at), last.id) : null,
  };
}

export async function listMessages(
  userId: string,
  username: string,
  cursor: string | undefined,
  limit: number,
) {
  const target = await findMessageTarget(username);
  const rows = await withTransaction(async (tx) => {
    await assertMessagingAllowed(tx, userId, target.id);
    return findConversationMessages(
      userId,
      target.id,
      cursor ? decodeCursor(cursor) : null,
      limit,
      tx,
    );
  });
  const hasMore = rows.length > limit;
  const items = (hasMore ? rows.slice(0, limit) : rows).map(toMessageItem);
  const last = hasMore ? rows[limit - 1] : undefined;
  return {
    items,
    nextCursor: last ? encodeCursor(new Date(last.created_at), last.id) : null,
  };
}

export async function sendMessage(
  userId: string,
  username: string,
  body: string,
): Promise<MessageItem> {
  const target = await findMessageTarget(username);
  if (target.id === userId) {
    throw new AppError(400, 'VALIDATION_ERROR', 'You cannot message yourself');
  }
  let notification: NotificationItem | null = null;
  let message: MessageItem;

  await withTransaction(async (tx) => {
    await assertMessagingAllowed(tx, userId, target.id);
    const row = await insertMessage(userId, target.id, body, tx);
    message = toMessageItem(row);
    const notificationRow = await insertNotification(
      {
        userId: target.id,
        actorId: userId,
        type: 'message',
        payload: { messageId: row.id },
      },
      tx,
    );
    notification = toNotificationItem(notificationRow);
  });

  const result = message!;
  if (notification) {
    emitNotification(target.id, notification);
    sendToUser(target.id, { type: 'message', message: result });
  }
  return result;
}

export async function markMessagesRead(userId: string, username: string): Promise<string[]> {
  const target = await findMessageTarget(username);
  const messageIds = await withTransaction(async (tx) => {
    await assertMessagingAllowed(tx, userId, target.id);
    return markConversationRead(userId, target.id, tx);
  });
  if (messageIds.length > 0) {
    sendToUser(target.id, {
      type: 'messages_read',
      readerId: userId,
      messageIds,
    });
  }
  return messageIds;
}
