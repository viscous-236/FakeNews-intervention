/**
 * Express application factory (REQ-011, REQ-036).
 *
 * createApp() builds and returns the Express app without starting the HTTP
 * listener.  index.ts calls createApp() then app.listen().  Tests import
 * createApp() directly and use supertest.
 */

import express, { NextFunction, Request, Response, Router } from 'express';
import { randomUUID } from 'crypto';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { logger } from './logger.js';
import { config } from './config.js';
import { healthRouter } from './modules/health/routes.js';
import { authRouter } from './modules/auth/routes.js';
import { usersRouter } from './modules/users/routes.js';
import { mediaRouter } from './modules/media/routes.js';
import { notificationsRouter } from './modules/notifications/routes.js';
import { postsRouter } from './modules/posts/routes.js';
import { feedRouter } from './modules/feed/routes.js';
import { scoreRouter } from './modules/score/routes.js';
import { governanceRouter } from './modules/governance/routes.js';
import { adminRouter } from './modules/admin/routes.js';
import { socialRouter } from './modules/social/routes.js';
import { searchRouter } from './modules/search/routes.js';
import { messagesRouter } from './modules/messages/routes.js';
import { detectionAdminRouter } from './modules/admin/detectionRoutes.js';
import { securityMiddleware } from './middleware/security.js';
import { originCheck } from './middleware/originCheck.js';
import { globalLimiter } from './middleware/rateLimit.js';
import { errorHandler, notFoundHandler, AppError, ErrorEnvelope } from './middleware/errors.js';
import { initSentry } from './sentry.js';
import { metricsMiddleware, metricsHandler } from './metrics.js';

export { AppError, ErrorEnvelope };

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
export function createApp(): express.Application {
  initSentry();
  const app = express();

  // ---- Trust proxy (Section 1.9) -------------------------------------------
  app.set('trust proxy', config.TRUST_PROXY);

  // ---- Request ID ----------------------------------------------------------
  app.use((req: Request, _res: Response, next: NextFunction): void => {
    (req as Request & { id: string }).id = randomUUID();
    next();
  });

  // ---- Prometheus metrics collection ---------------------------------------
  app.use(metricsMiddleware);

  // ---- Security headers (Helmet & CSP) -------------------------------------
  app.use(securityMiddleware());

  // ---- Cookie parser -------------------------------------------------------
  app.use(cookieParser());

  // ---- Origin check (CSRF defense for non-GET/HEAD) ------------------------
  app.use(originCheck);

  // ---- Global rate limit: 300 requests per minute per IP (Section 1.7) ----
  app.use(globalLimiter);

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

  // ---- Root-level endpoints ------------------------------------------------
  app.use(healthRouter);
  app.get('/metrics', metricsHandler);

  // ---- API v1 Router -------------------------------------------------------
  const apiV1 = Router();
  apiV1.use(authRouter);
  apiV1.use(usersRouter);
  apiV1.use(mediaRouter);
  apiV1.use(notificationsRouter);
  apiV1.use(postsRouter);
  apiV1.use(feedRouter);
  apiV1.use(scoreRouter);
  apiV1.use(governanceRouter);
  apiV1.use(adminRouter);
  apiV1.use(detectionAdminRouter);
  apiV1.use(socialRouter);
  apiV1.use(searchRouter);
  apiV1.use(messagesRouter);
  app.use('/api/v1', apiV1);

  // ---- 404 handler ---------------------------------------------------------
  app.use(notFoundHandler);

  // ---- Central error handler -----------------------------------------------
  app.use(errorHandler);

  return app;
}
