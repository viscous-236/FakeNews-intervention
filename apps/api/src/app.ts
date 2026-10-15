/**
 * Express application factory (REQ-011, REQ-036).
 *
 * createApp() builds and returns the Express app without starting the HTTP
 * listener.  index.ts calls createApp() then app.listen().  Tests import
 * createApp() directly and use supertest.
 */

import express, { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import pinoHttp from 'pino-http';
import { logger } from './logger';
import { healthRouter } from './modules/health/routes';

// ---------------------------------------------------------------------------
// Error envelope type
// ---------------------------------------------------------------------------
export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId: string;
  };
}

// ---------------------------------------------------------------------------
// App-level error class
// ---------------------------------------------------------------------------
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
export function createApp(): express.Application {
  const app = express();

  // ---- Request ID ----------------------------------------------------------
  app.use((req: Request, _res: Response, next: NextFunction): void => {
    (req as Request & { id: string }).id = randomUUID();
    next();
  });

  // ---- Structured logging --------------------------------------------------
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as Request & { id?: string }).id ?? randomUUID(),
      customLogLevel(_req, res, err) {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
    }),
  );

  // ---- Body parsing --------------------------------------------------------
  app.use(express.json({ limit: '100kb' }));

  // ---- Routes --------------------------------------------------------------
  app.use(healthRouter);

  // NOTE: Additional routers (auth, posts, etc.) are mounted in later phases.
  //       They will be registered here under /api/v1.

  // ---- 404 handler ---------------------------------------------------------
  app.use((_req: Request, res: Response): void => {
    const requestId = (_req as Request & { id?: string }).id ?? randomUUID();
    const body: ErrorEnvelope = {
      error: {
        code: 'NOT_FOUND',
        message: 'The requested resource was not found.',
        requestId,
      },
    };
    res.status(404).json(body);
  });

  // ---- Central error handler -----------------------------------------------
  // Express 5 passes errors with 4 parameters; must have exactly 4.
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction): void => {
    const requestId = (req as Request & { id?: string }).id ?? randomUUID();

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

    // Unexpected error
    logger.error({ err, requestId }, 'Unhandled error');
    const body: ErrorEnvelope = {
      error: {
        code: 'INTERNAL',
        message: 'An unexpected error occurred.',
        requestId,
      },
    };
    res.status(500).json(body);
  });

  return app;
}
