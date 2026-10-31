/**
 * Express application factory (REQ-011, REQ-036).
 *
 * createApp() builds and returns the Express app without starting the HTTP
 * listener.  index.ts calls createApp() then app.listen().  Tests import
 * createApp() directly and use supertest.
 */

import express, { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { logger } from './logger.js';
import { healthRouter } from './modules/health/routes.js';
import { securityMiddleware } from './middleware/security.js';
import { originCheck } from './middleware/originCheck.js';
import { errorHandler, notFoundHandler, AppError, ErrorEnvelope } from './middleware/errors.js';

export { AppError, ErrorEnvelope };

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

  // ---- Security headers (Helmet & CSP) -------------------------------------
  app.use(securityMiddleware());

  // ---- Cookie parser -------------------------------------------------------
  app.use(cookieParser());

  // ---- Origin check (CSRF defense for non-GET/HEAD) ------------------------
  app.use(originCheck);

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

  // NOTE: Additional routers (auth, posts, etc.) are mounted in later tasks
  //       under /api/v1.

  // ---- 404 handler ---------------------------------------------------------
  app.use(notFoundHandler);

  // ---- Central error handler -----------------------------------------------
  app.use(errorHandler);

  return app;
}
