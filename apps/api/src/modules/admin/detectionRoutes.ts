import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { getDetectorStatus, redetectPost, requeueDetection } from '../../detection/admin.js';

export const detectionAdminRouter = Router();
const idParams = z.object({ id: z.string().uuid() }).strict();

detectionAdminRouter.post(
  '/admin/posts/:id/redetect',
  requireAdmin,
  validate({ params: idParams }),
  async (req, res, next) => {
    try {
      const detectionId = await redetectPost(req.params.id as string, req.user!.id);
      res.status(202).json({ detectionId });
    } catch (error) {
      next(error);
    }
  },
);

detectionAdminRouter.post(
  '/admin/detections/:id/requeue',
  requireAdmin,
  validate({ params: idParams }),
  async (req, res, next) => {
    try {
      await requeueDetection(req.params.id as string, req.user!.id);
      res.status(202).send();
    } catch (error) {
      next(error);
    }
  },
);

detectionAdminRouter.get('/admin/detector/status', requireAdmin, async (_req, res, next) => {
  try {
    res.json(await getDetectorStatus());
  } catch (error) {
    next(error);
  }
});
