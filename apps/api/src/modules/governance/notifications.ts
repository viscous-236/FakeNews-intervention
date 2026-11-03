/** Persist governance notifications inside the transaction; publish after commit. */
import { type PoolClient } from '../../db/pool.js';
import { insertNotification, type InsertNotificationParams } from '../notifications/repo.js';
import { toNotificationItem, type NotificationItem } from '../notifications/service.js';
import { emitNotification } from '../notifications/bus.js';

export interface PendingNotification {
  userId: string;
  item: NotificationItem;
}

export async function queueGovernanceNotification(
  tx: PoolClient,
  pending: PendingNotification[],
  params: InsertNotificationParams,
): Promise<void> {
  if (params.userId === params.actorId) return;
  const row = await insertNotification(params, tx);
  pending.push({ userId: params.userId, item: toNotificationItem(row) });
}

export function publishGovernanceNotifications(pending: PendingNotification[]): void {
  for (const notification of pending) emitNotification(notification.userId, notification.item);
}
