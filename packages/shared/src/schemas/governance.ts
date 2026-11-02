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
