/**
 * apps/api/src/shutdown.ts (REQ-037, TASK-105)
 *
 * Graceful shutdown coordinator:
 *   - Stops background loops (detection worker, auto-real, wave scheduler, email outbox, media cleanup)
 *   - Closes SSE and WebSocket connections
 *   - Drains HTTP listener
 *   - Closes DB connection pool
 */

import type { Server } from 'http';
import type { WebSocketServer } from 'ws';
import { logger } from './logger.js';
import { closePool } from './db/pool.js';
import { closeAllConnections } from './realtime/hub.js';
import {
  stopAutoReal,
  stopDetectionWorker,
  stopEmailOutbox,
  stopMediaCleanup,
  stopWaveScheduler,
} from './jobs/index.js';

export interface ShutdownContext {
  server: Server;
  wss?: WebSocketServer;
}

export async function executeGracefulShutdown(context: ShutdownContext): Promise<void> {
  logger.info('Graceful shutdown initiated');

  // 1. Stop background processing loops
  const detectionStopped = stopDetectionWorker();
  stopAutoReal();
  stopWaveScheduler();
  stopEmailOutbox();
  stopMediaCleanup();

  // 2. Terminate real-time SSE and WebSocket clients
  closeAllConnections();
  if (context.wss) {
    context.wss.close();
  }

  // 3. Drain and close HTTP server
  await new Promise<void>((resolve) => {
    context.server.close(() => {
      logger.info('HTTP server drained and closed');
      resolve();
    });
  });

  // 4. Await in-flight detection work and close database connection pool
  await detectionStopped;
  await closePool();
  logger.info('Database pool closed; graceful shutdown complete');
}
