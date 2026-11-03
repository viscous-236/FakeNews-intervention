/** Validation schemas for direct messages (REQ-042). */

import { z } from 'zod';

export const messageSchema = z
  .object({
    body: z.string().trim().min(1).max(1000),
  })
  .strict();

export const listMessagesQuerySchema = z
  .object({
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

export type MessageInput = z.infer<typeof messageSchema>;
export type ListMessagesQuery = z.infer<typeof listMessagesQuerySchema>;
