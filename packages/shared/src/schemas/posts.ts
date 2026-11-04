/**
 * packages/shared/src/schemas/posts.ts (TASK-043)
 *
 * Validation schemas for posts operations.
 */

import { z } from 'zod';

export const createPostSchema = z
  .object({
    body: z
      .string()
      .trim()
      .min(20, 'Post body must be at least 20 characters')
      .max(500, 'Post body must not exceed 500 characters'),
    sourceUrl: z
      .string()
      .trim()
      .url('sourceUrl must be a valid URL')
      .max(2048, 'sourceUrl must not exceed 2048 characters')
      .optional(),
    mediaIds: z.array(z.string().uuid()).max(4, 'A maximum of 4 images can be attached').optional(),
  })
  .strict();

export type CreatePostInput = z.infer<typeof createPostSchema>;

export const editPostSchema = z
  .object({
    body: z
      .string()
      .trim()
      .min(20, 'Post body must be at least 20 characters')
      .max(500, 'Post body must not exceed 500 characters')
      .optional(),
    sourceUrl: z
      .string()
      .trim()
      .url('sourceUrl must be a valid URL')
      .max(2048, 'sourceUrl must not exceed 2048 characters')
      .nullable()
      .optional(),
  })
  .strict();

export type EditPostInput = z.infer<typeof editPostSchema>;

export const listPostsQuerySchema = z
  .object({
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

export type ListPostsQuery = z.infer<typeof listPostsQuerySchema>;
