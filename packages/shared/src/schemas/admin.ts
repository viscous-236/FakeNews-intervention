/**
 * packages/shared/src/schemas/admin.ts (TASK-059, TASK-073, TASK-074)
 *
 * Validation schemas for administrator queries, analytics, and exports.
 */

import { z } from 'zod';

export const adminListQuerySchema = z
  .object({
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

export type AdminListQuery = z.infer<typeof adminListQuerySchema>;

export const userListQuerySchema = adminListQuerySchema
  .extend({
    q: z.string().trim().min(1).max(100).optional(),
    status: z.enum(['active', 'suspended', 'deleted']).optional(),
  })
  .strict();

export type UserListQuery = z.infer<typeof userListQuerySchema>;

export const auditQuerySchema = adminListQuerySchema
  .extend({
    action: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

export type AuditQuery = z.infer<typeof auditQuerySchema>;

export const exportQuerySchema = z
  .object({
    waveNumber: z.coerce.number().int().positive().optional(),
  })
  .strict();

export type ExportQuery = z.infer<typeof exportQuerySchema>;

export const suspendUserSchema = z
  .object({
    reason: z.string().trim().min(5).max(1000),
  })
  .strict();

export type SuspendUserInput = z.infer<typeof suspendUserSchema>;
