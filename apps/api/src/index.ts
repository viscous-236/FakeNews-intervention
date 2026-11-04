/**
 * HTTP server entry point.
 *
 * Importing ./config validates the environment and stops the process with a
 * readable error on bad input (REQ-036). This module creates the Express app,
 * listens, starts the background loops, and registers graceful shutdown
 * (REQ-037).
 */

import { config } from './config';
import { createApp } from './app';
import { logger } from './logger';
import { executeGracefulShutdown } from './shutdown.js';
import { attachWebSocketServer } from './realtime/ws';
import {
  startAutoReal,
  startDetectionWorker,
  startEmailOutbox,
  startMediaCleanup,
  startWaveScheduler,
} from './jobs/index';

const app = createApp();

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, env: config.NODE_ENV }, 'API server started');
  startDetectionWorker();
  startAutoReal();
  startWaveScheduler();
  startEmailOutbox();
  startMediaCleanup();
});
const webSocketServer = attachWebSocketServer(server);

// ---------------------------------------------------------------------------
// Graceful shutdown (REQ-037)
// ---------------------------------------------------------------------------
let shuttingDown = false;
const shutdown = (signal: string): void => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutdown signal received');

  executeGracefulShutdown({ server, wss: webSocketServer })
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error({ err }, 'Error during graceful shutdown');
      process.exit(1);
    });

  // Force exit after 20 s (REQ-037)
  setTimeout(() => {
    logger.error('Graceful shutdown timeout — forcing exit');
    process.exit(1);
  }, 20_000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
