/**
 * apps/api/src/sentry.ts (TASK-104)
 *
 * Sentry error monitoring integration.
 * Active only when SENTRY_DSN is configured.
 */

import * as Sentry from '@sentry/node';
import { config } from './config.js';
import { logger } from './logger.js';

let initialized = false;

export function initSentry(): void {
  if (!config.SENTRY_DSN) {
    logger.debug('Sentry disabled (no SENTRY_DSN configured)');
    return;
  }

  try {
    Sentry.init({
      dsn: config.SENTRY_DSN,
      environment: config.NODE_ENV,
      tracesSampleRate: config.NODE_ENV === 'production' ? 0.2 : 1.0,
    });
    initialized = true;
    logger.info('Sentry initialized successfully');
  } catch (err) {
    logger.error({ err }, 'Failed to initialize Sentry');
  }
}

export function captureException(err: unknown, context?: Record<string, unknown>): void {
  if (!initialized) return;
  try {
    Sentry.captureException(err, { extra: context });
  } catch {
    // ignore capture failure
  }
}
