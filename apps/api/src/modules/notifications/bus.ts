/**
 * apps/api/src/modules/notifications/bus.ts (TASK-042)
 *
 * In-process event bus for real-time notification dispatch via SSE.
 */

import { EventEmitter } from 'events';

export const notificationBus = new EventEmitter();
notificationBus.setMaxListeners(2000);

export function emitNotification(userId: string, notification: unknown): void {
  notificationBus.emit(`notification:${userId}`, notification);
}
