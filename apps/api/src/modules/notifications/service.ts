/**
 * apps/api/src/modules/notifications/service.ts (TASK-042, RUL-025, REQ-041, REQ-044)
 *
 * Notification creation, pagination, read tracking, and real-time event dispatch.
 */

import { type PoolClient } from '../../db/pool.js';
import { config } from '../../config.js';
import { encodeCursor, decodeCursor, type DecodedCursor } from '../../db/cursor.js';
import { tierOfValue } from '../../scoring/tier.js';
import { emitNotification } from './bus.js';
import {
  insertNotification,
  findNotifications,
  countUnreadNotifications,
  markNotificationsAsRead,
  type NotificationJoinedRow,
  type NotificationType,
  type InsertNotificationParams,
} from './repo.js';

export interface UserSummary {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  tier: 'trusted' | 'neutral' | 'low';
}

export interface NotificationItem {
  id: string;
  type: NotificationType;
  actor: UserSummary | null;
  postId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
  readAt: string | null;
}

export function toNotificationItem(row: NotificationJoinedRow): NotificationItem {
  return {
    id: row.id,
    type: row.type,
    actor:
      row.actor_id && row.actor_username && row.actor_display_name
        ? {
            id: row.actor_id,
            username: row.actor_username,
            displayName: row.actor_display_name,
            avatarUrl: row.actor_avatar_media_id
              ? `${config.S3_PUBLIC_BASE_URL}/${row.actor_avatar_media_id}`
              : null,
            tier: tierOfValue(row.actor_q ?? 0),
          }
        : null,
    postId: row.post_id,
    payload: row.payload ?? {},
    createdAt: new Date(row.created_at).toISOString(),
    readAt: row.read_at ? new Date(row.read_at).toISOString() : null,
  };
}

export async function createNotification(
  params: InsertNotificationParams,
  client?: PoolClient,
): Promise<NotificationItem | null> {
  // RUL-025: Users never receive a notification about their own action
  if (params.actorId && params.actorId === params.userId) {
    return null;
  }

  const row = await insertNotification(params, client);
  const item = toNotificationItem(row);

  // Push to SSE fan-out event bus
  emitNotification(params.userId, item);

  return item;
}

export async function listNotifications(
  userId: string,
  options: {
    unreadOnly?: boolean;
    cursor?: string;
    limit: number;
  },
  client?: PoolClient,
): Promise<{ items: NotificationItem[]; nextCursor: string | null }> {
  let decodedCursor: DecodedCursor | null = null;
  if (options.cursor) {
    decodedCursor = decodeCursor(options.cursor);
  }

  const rows = await findNotifications(
    userId,
    {
      unreadOnly: options.unreadOnly,
      cursor: decodedCursor,
      limit: options.limit,
    },
    client,
  );

  const hasMore = rows.length > options.limit;
  const itemsToReturn = hasMore ? rows.slice(0, options.limit) : rows;

  const items = itemsToReturn.map(toNotificationItem);
  let nextCursor: string | null = null;

  if (hasMore && itemsToReturn.length > 0) {
    const lastRow = itemsToReturn[itemsToReturn.length - 1]!;
    nextCursor = encodeCursor(new Date(lastRow.created_at), lastRow.id);
  }

  return {
    items,
    nextCursor,
  };
}

export async function getUnreadCount(userId: string, client?: PoolClient): Promise<number> {
  return countUnreadNotifications(userId, client);
}

export async function markAsRead(
  userId: string,
  ids?: string[],
  client?: PoolClient,
): Promise<void> {
  await markNotificationsAsRead(userId, ids, client);
}
