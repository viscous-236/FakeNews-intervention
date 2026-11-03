/** Direct-message REST endpoints (REQ-042). */

import { NextFunction, Request, Response, Router } from 'express';
import { listMessagesQuerySchema, messageSchema } from '@app/shared';
import { requireActive, requireAuth } from '../../middleware/auth.js';
import { messagesLimiter } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import {
  listConversations,
  listMessages,
  markMessagesRead,
  sendMessage,
} from './service.js';
import { z } from 'zod';

export const messagesRouter = Router();
const usernameParams = z.object({ username: z.string().min(3).max(20) }).strict();

messagesRouter.get(
  '/messages/conversations',
  requireAuth,
  validate({ query: listMessagesQuerySchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = req.query as unknown as { cursor?: string; limit?: number };
      res.json(await listConversations(req.user!.id, query.cursor, query.limit ?? 20));
    } catch (error) {
      next(error);
    }
  },
);

messagesRouter.get(
  '/messages/with/:username',
  requireAuth,
  validate({ params: usernameParams, query: listMessagesQuerySchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = req.query as unknown as { cursor?: string; limit?: number };
      res.json(
        await listMessages(
          req.user!.id,
          req.params.username as string,
          query.cursor,
          query.limit ?? 20,
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);

messagesRouter.post(
  '/messages/with/:username',
  requireActive,
  messagesLimiter,
  validate({ params: usernameParams, body: messageSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.status(201).json(await sendMessage(req.user!.id, req.params.username as string, req.body.body));
    } catch (error) {
      next(error);
    }
  },
);

messagesRouter.post(
  '/messages/with/:username/read',
  requireAuth,
  validate({ params: usernameParams }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await markMessagesRead(req.user!.id, req.params.username as string);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);
