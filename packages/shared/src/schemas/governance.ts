/** Validation schemas for reports and administrator assessments. */

import { z } from 'zod';
import { assessmentVerdictSchema, reportReasonSchema } from '../enums.js';

export const reportSchema = z
  .object({
    reason: reportReasonSchema,
    details: z.string().trim().max(500).optional(),
  })
  .strict();

export type ReportInput = z.infer<typeof reportSchema>;

export const assessmentSchema = z
  .object({
    verdict: assessmentVerdictSchema,
    rationale: z.string().trim().min(10).max(2000),
    detectionResultId: z.string().uuid().optional(),
  })
  .strict();

export type AssessmentInput = z.infer<typeof assessmentSchema>;

export const resolveAppealSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('upheld'), note: z.string().trim().min(10).max(1000) }).strict(),
  z
    .object({
      decision: z.literal('overturned'),
      note: z.string().trim().min(10).max(1000),
      newVerdict: z.enum(['real', 'unverifiable']),
      rationale: z.string().trim().min(10).max(2000),
    })
    .strict(),
]);
export type ResolveAppealInput = z.infer<typeof resolveAppealSchema>;

export const listAdminAppealsQuerySchema = z
  .object({
    status: z.enum(['open', 'upheld', 'overturned']).optional(),
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
export type ListAdminAppealsQuery = z.infer<typeof listAdminAppealsQuerySchema>;
