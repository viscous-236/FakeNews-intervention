/** Governance routes for user reports and administrator assessments. */

import { NextFunction, Request, Response, Router } from 'express';
import { assessmentSchema, reportSchema } from '@app/shared';
import { requireActive, requireAdmin } from '../../middleware/auth.js';
import { reportsLimiter } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import { assessPost } from './assessments.js';
import { createReport } from './reports.js';

export const governanceRouter = Router();

governanceRouter.post(
  '/posts/:id/report',
  requireActive,
  reportsLimiter,
  validate({ body: reportSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const report = await createReport(req.params.id as string, req.user!.id, req.body);
      res.status(201).json(report);
    } catch (error) {
      next(error);
    }
  },
);

governanceRouter.post(
  '/admin/posts/:id/assessments',
  requireAdmin,
  validate({ body: assessmentSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await assessPost(req.params.id as string, req.user!.id, req.body);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  },
);
