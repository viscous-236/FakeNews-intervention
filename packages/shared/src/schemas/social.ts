/** Validation schemas for social interactions. */

import { z } from 'zod';

export const commentSchema = z.object({ body: z.string().trim().min(1).max(300) }).strict();

export type CommentInput = z.infer<typeof commentSchema>;

export const listCommentsQuerySchema = z
  .object({
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

export const reshareSchema = z
  .object({
    comment: z.string().trim().max(500).optional(),
    acknowledgedWarning: z.boolean().optional().default(false),
  })
  .strict();

export type ReshareInput = z.infer<typeof reshareSchema>;

export const listUsersQuerySchema = z
  .object({
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

export const searchQuerySchema = z
  .object({
    q: z.string().trim().min(2).max(100),
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
export type SearchQuery = z.infer<typeof searchQuerySchema>;
