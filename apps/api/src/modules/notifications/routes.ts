/**
 * apps/api/src/modules/notifications/routes.ts (TASK-042, REQ-041)
 *
 * Notification REST endpoints and Server-Sent Events (SSE) stream.
 */

import { Router, Request, Response, NextFunction } from 'express';
import {
  readNotificationsSchema,
  listNotificationsQuerySchema,
} from '@app/shared';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { notificationBus } from './bus.js';
import {
  listNotifications,
  getUnreadCount,
  markAsRead,
  type NotificationItem,
} from './service.js';

export const notificationsRouter = Router();

// GET /notifications (Auth, cursor paginated, optional ?unread=true)
notificationsRouter.get(
  '/notifications',
  requireAuth,
  validate({ query: listNotificationsQuerySchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = req.query as unknown as {
        unread?: 'true' | 'false';
        cursor?: string;
        limit?: number;
      };

      const result = await listNotifications(req.user!.id, {
        unreadOnly: query.unread === 'true',
        cursor: query.cursor,
        limit: Number(query.limit ?? 20),
      });

      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);

// GET /notifications/unread-count (Auth)
notificationsRouter.get(
  '/notifications/unread-count',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const count = await getUnreadCount(req.user!.id);
      res.status(200).json({ count });
    } catch (err) {
      next(err);
    }
  },
);

// POST /notifications/read (Auth, body { ids?: uuid[] })
notificationsRouter.post(
  '/notifications/read',
  requireAuth,
  validate({ body: readNotificationsSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await markAsRead(req.user!.id, req.body.ids);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);

// GET /notifications/stream (Auth, SSE text/event-stream per REQ-041)
notificationsRouter.get(
  '/notifications/stream',
  requireAuth,
  (req: Request, res: Response): void => {
    // 1. Establish SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // 2. Initial connection handshake comment
    res.write(': connected\n\n');

    const userId = req.user!.id;
    const channel = `notification:${userId}`;

    // 3. Listener for dispatched notifications
    const onNotification = (item: NotificationItem): void => {
      res.write(`id: ${item.id}\n`);
      res.write(`event: notification\n`);
      res.write(`data: ${JSON.stringify(item)}\n\n`);
    };

    notificationBus.on(channel, onNotification);

    // 4. Comment heartbeat every 25 seconds per plan line 912
    const heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, 25_000);

    // 5. Cleanup on disconnect
    req.on('close', () => {
      clearInterval(heartbeat);
      notificationBus.off(channel, onNotification);
    });
  },
);
