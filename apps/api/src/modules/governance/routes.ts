/** Governance routes for user reports and administrator assessments. */

import { NextFunction, Request, Response, Router } from 'express';
import {
  assessmentSchema,
  reportSchema,
  resolveAppealSchema,
  listAdminAppealsQuerySchema,
  type ListAdminAppealsQuery,
} from '@app/shared';
import { z } from 'zod';
import { requireActive, requireAdmin } from '../../middleware/auth.js';
import { reportsLimiter } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import { assessPost } from './assessments.js';
import { createReport } from './reports.js';
import { listAdminAppeals, resolveAppeal } from './appeals.js';

export const governanceRouter = Router();
const idParams = z.object({ id: z.string().uuid() }).strict();

governanceRouter.get(
  '/admin/appeals',
  requireAdmin,
  validate({ query: listAdminAppealsQuerySchema }),
  async (req, res, next) => {
    try {
      res.json(await listAdminAppeals(req.query as unknown as ListAdminAppealsQuery));
    } catch (error) {
      next(error);
    }
  },
);

governanceRouter.post(
  '/admin/appeals/:id/resolve',
  requireAdmin,
  validate({ params: idParams, body: resolveAppealSchema }),
  async (req, res, next) => {
    try {
      res.json(await resolveAppeal(req.params.id as string, req.user!.id, req.body));
    } catch (error) {
      next(error);
    }
  },
);

governanceRouter.post(
  '/posts/:id/report',
  requireActive,
  reportsLimiter,
  validate({ body: reportSchema, params: idParams }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const report = await createReport(
        req.params.id as string,
        req.user!.id,
        req.body,
        req.user!.role,
      );
      res.status(201).json(report);
    } catch (error) {
      next(error);
    }
  },
);

governanceRouter.post(
  '/admin/posts/:id/assessments',
  requireAdmin,
  validate({ body: assessmentSchema, params: idParams }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await assessPost(req.params.id as string, req.user!.id, req.body);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  },
);
