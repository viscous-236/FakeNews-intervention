/**
 * apps/api/src/modules/media/routes.ts (TASK-041)
 *
 * Media upload route (POST /media).
 */

import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { requireActive } from '../../middleware/auth.js';
import { mediaLimiter } from '../../middleware/rateLimit.js';
import { AppError } from '../../middleware/errors.js';
import { processAndUploadMedia } from './service.js';

export const mediaRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB max per REQ-022 and plan line 887
  },
});

mediaRouter.post(
  '/media',
  requireActive,
  mediaLimiter,
  (req: Request, res: Response, next: NextFunction): void => {
    upload.single('file')(req, res, (err) => {
      if (err) {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
          return next(
            new AppError(413, 'PAYLOAD_TOO_LARGE', 'Image file exceeds 5 MB limit'),
          );
        }
        return next(err);
      }
      next();
    });
  },
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.file) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Missing required file field');
      }

      const kind = req.body.kind;
      if (kind !== 'avatar' && kind !== 'post_image') {
        throw new AppError(
          400,
          'VALIDATION_ERROR',
          "Field 'kind' must be either 'avatar' or 'post_image'",
        );
      }

      const result = await processAndUploadMedia({
        ownerId: req.user!.id,
        kind,
        buffer: req.file.buffer,
        mimeType: req.file.mimetype,
      });

      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);
