/**
 * HTTP server entry point.
 *
 * Loads config (fails fast on bad env — REQ-036), creates the Express app,
 * listens, and registers graceful shutdown (REQ-037).
 */

import { config, parseConfig } from './config';
import { createApp } from './app';
import { logger } from './logger';
import { closePool } from './db/pool';
import {
  startAutoReal,
  startDetectionWorker,
  startEmailOutbox,
  startMediaCleanup,
  startWaveScheduler,
  stopAutoReal,
  stopDetectionWorker,
  stopEmailOutbox,
  stopMediaCleanup,
  stopWaveScheduler,
} from './jobs/index';

// ---------------------------------------------------------------------------
// Fail fast on bad env — must happen before any other import
// that reads config.  Because config is a module-level singleton, any import
// of ./config triggers parseConfig.  If that throws, the process exits here.
// ---------------------------------------------------------------------------
try {
  // parseConfig is already called when ./config is imported above.
  // This explicit call is here so that the error is caught and formatted.
  parseConfig(process.env as NodeJS.ProcessEnv);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

const app = createApp();

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, env: config.NODE_ENV }, 'API server started');
  startDetectionWorker();
  startAutoReal();
  startWaveScheduler();
  startEmailOutbox();
  startMediaCleanup();
});

// ---------------------------------------------------------------------------
// Graceful shutdown (REQ-037)
// ---------------------------------------------------------------------------
let shuttingDown = false;
const shutdown = (signal: string): void => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutdown signal received');

  stopDetectionWorker();
  stopAutoReal();
  stopWaveScheduler();
  stopEmailOutbox();
  stopMediaCleanup();

  server.close(() => {
    logger.info('HTTP server closed');
    void closePool().then(() => process.exit(0));
  });

  // Force exit after 20 s
  setTimeout(() => {
    logger.error('Graceful shutdown timeout — forcing exit');
    process.exit(1);
  }, 20_000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
