/**
 * packages/shared/src/schemas/score.ts (TASK-045, RUL-016)
 */

import { z } from 'zod';

export const appealSchema = z
  .object({
    reason: z.string().trim().min(20).max(1000),
  })
  .strict();
export type AppealInput = z.infer<typeof appealSchema>;

export const listEventsQuerySchema = z
  .object({
    status: z.enum(['eligible', 'held', 'counted', 'voided']).optional(),
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
export type ListEventsQuery = z.infer<typeof listEventsQuerySchema>;

export const listScoreHistoryQuerySchema = z
  .object({
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
export type ListScoreHistoryQuery = z.infer<typeof listScoreHistoryQuerySchema>;

export const listAppealsQuerySchema = z
  .object({
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
export type ListAppealsQuery = z.infer<typeof listAppealsQuerySchema>;
