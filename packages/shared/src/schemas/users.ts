/**
 * packages/shared/src/schemas/users.ts (TASK-040)
 *
 * Validation schemas for user endpoints.
 */

import { z } from 'zod';

export const updateMeSchema = z
  .object({
    displayName: z
      .string()
      .trim()
      .min(1, 'Display name cannot be empty')
      .max(50, 'Display name must not exceed 50 characters')
      .optional(),
    bio: z
      .string()
      .max(300, 'Bio must not exceed 300 characters')
      .optional(),
    avatarMediaId: z
      .string()
      .uuid('Invalid avatar media ID')
      .nullable()
      .optional(),
  })
  .strict();

export type UpdateMeInput = z.infer<typeof updateMeSchema>;
