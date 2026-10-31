/**
 * packages/shared/src/schemas/notifications.ts (TASK-042)
 *
 * Schemas for notification operations.
 */

import { z } from 'zod';

export const readNotificationsSchema = z
  .object({
    ids: z.array(z.string().uuid()).optional(),
  })
  .strict();

export type ReadNotificationsInput = z.infer<typeof readNotificationsSchema>;

export const listNotificationsQuerySchema = z
  .object({
    unread: z.enum(['true', 'false']).optional(),
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;
