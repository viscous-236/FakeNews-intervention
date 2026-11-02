/** Validation schemas for social interactions. */

import { z } from 'zod';

export const commentSchema = z
  .object({ body: z.string().trim().min(1).max(300) })
  .strict();

export type CommentInput = z.infer<typeof commentSchema>;

export const listCommentsQuerySchema = z
  .object({
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
