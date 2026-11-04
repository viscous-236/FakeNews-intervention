/**
 * apps/api/src/middleware/errors.ts (TASK-037, REQ-011)
 *
 * Central error handling and 404 handlers producing the standard error envelope.
 */

import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { ZodError } from 'zod';
import { logger } from '../logger.js';
import { captureException } from '../sentry.js';
import { isPgError, mapPgError } from '../db/errors.js';
import { AppError, ErrorEnvelope } from './appError.js';

export { AppError, ErrorEnvelope };

export function notFoundHandler(req: Request, res: Response): void {
  const requestId = (req as Request & { id?: string }).id ?? randomUUID();
  const body: ErrorEnvelope = {
    error: {
      code: 'NOT_FOUND',
      message: 'The requested resource was not found.',
      requestId,
    },
  };
  res.status(404).json(body);
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const requestId = (req as Request & { id?: string }).id ?? randomUUID();

  // AppError domain exception
  if (err instanceof AppError) {
    const body: ErrorEnvelope = {
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
        requestId,
      },
    };
    res.status(err.statusCode).json(body);
    return;
  }

  // Zod validation exception
  if (err instanceof ZodError) {
    const fields: Record<string, string[]> = {};
    for (const issue of err.issues) {
      const path = issue.path.join('.') || 'root';
      (fields[path] ??= []).push(issue.message);
    }
    const body: ErrorEnvelope = {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: { fields },
        requestId,
      },
    };
    res.status(400).json(body);
    return;
  }

  // JSON syntax error from express.json()
  if (err instanceof SyntaxError && 'status' in err && (err as { status: unknown }).status === 400) {
    const body: ErrorEnvelope = {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Malformed JSON in request body',
        requestId,
      },
    };
    res.status(400).json(body);
    return;
  }

  // PostgreSQL mapped error
  if (isPgError(err)) {
    const mapped = mapPgError(err);
    const body: ErrorEnvelope = {
      error: {
        code: mapped.code,
        message: mapped.message,
        ...(mapped.details !== undefined ? { details: mapped.details } : {}),
        requestId,
      },
    };
    res.status(mapped.statusCode).json(body);
    return;
  }

  // Generic HTTP status error (e.g. from multer or other middleware)
  const candidateStatus =
    (err as { statusCode?: unknown })?.statusCode || (err as { status?: unknown })?.status;
  if (typeof candidateStatus === 'number' && candidateStatus >= 400 && candidateStatus < 600) {
    const code =
      (err as { code?: unknown })?.code && typeof (err as { code?: unknown }).code === 'string'
        ? String((err as { code?: unknown }).code)
        : candidateStatus === 429
          ? 'RATE_LIMITED'
          : candidateStatus === 413
            ? 'PAYLOAD_TOO_LARGE'
            : candidateStatus === 415
              ? 'UNSUPPORTED_MEDIA_TYPE'
              : 'INTERNAL';
    const message = (err as Error)?.message || 'An error occurred';
    res.status(candidateStatus).json({
      error: {
        code,
        message,
        requestId,
      },
    });
    return;
  }

  // Unexpected internal server error
  captureException(err, { requestId });
  logger.error({ err, requestId }, 'Unhandled error');
  const body: ErrorEnvelope = {
    error: {
      code: 'INTERNAL',
      message: 'An unexpected error occurred.',
      requestId,
    },
  };
  res.status(500).json(body);
}
