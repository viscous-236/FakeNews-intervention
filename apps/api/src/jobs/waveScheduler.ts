/**
 * apps/api/src/jobs/waveScheduler.ts (TASK-025)
 *
 * Background loop that periodically checks if the open wave should be
 * auto-finalized based on WAVE_AUTO_FINALIZE_INTERVAL_HOURS.
 * Guarded by PostgreSQL transaction-level advisory lock (pg_try_advisory_xact_lock).
 */

import { withTransaction } from '../db/tx.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import {
  finalizeWaveInTransaction,
  publishFinalizeNotifications,
  type FinalizeWaveOutcome,
  type FinalizeWaveResult,
} from '../scoring/finalizeWave.js';

// Constant advisory lock identifier for the wave scheduler job
export const WAVE_SCHEDULER_LOCK_ID = 42001;

/**
 * Check if the current open wave has exceeded the configured auto-finalize interval
 * and finalize it under an advisory transaction lock.
 */
export async function checkAndFinalizeWave(): Promise<FinalizeWaveResult | null> {
  if (config.WAVE_AUTO_FINALIZE_INTERVAL_HOURS <= 0) {
    return null;
  }

  const outcome = await withTransaction<FinalizeWaveOutcome | null>(async (tx) => {
    // Attempt non-blocking transaction-scoped advisory lock
    const lockRes = await tx.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_xact_lock($1) AS locked`,
      [WAVE_SCHEDULER_LOCK_ID],
    );

    if (!lockRes.rows[0]?.locked) {
      // Another instance or thread holds the lock
      return null;
    }

    // Check if open wave is older than interval
    const waveRes = await tx.query<{ id: string; number: number }>(
      `SELECT id, number
       FROM waves
       WHERE status = 'open'
         AND opened_at <= now() - ($1 || ' hours')::interval
       LIMIT 1`,
      [config.WAVE_AUTO_FINALIZE_INTERVAL_HOURS],
    );

    const wave = waveRes.rows[0];
    if (!wave) {
      return null;
    }

    logger.info(
      { waveId: wave.id, waveNumber: wave.number },
      'Auto-finalizing wave due to interval expiration',
    );

    return finalizeWaveInTransaction(tx, wave.id, { kind: 'system' });
  });
  // Step 10 of Section 1.5: push SSE events only after the commit.
  if (outcome) publishFinalizeNotifications(outcome);
  return outcome;
}

let _schedulerInterval: NodeJS.Timeout | null = null;

/**
 * Start the 60-second periodic wave scheduler loop.
 */
export function startWaveScheduler(intervalMs = 60_000): void {
  if (_schedulerInterval) {
    return;
  }

  _schedulerInterval = setInterval(async () => {
    try {
      await checkAndFinalizeWave();
    } catch (err) {
      logger.error({ err }, 'Error in waveScheduler periodic check');
    }
  }, intervalMs);

  _schedulerInterval.unref();
}

/**
 * Stop the wave scheduler loop.
 */
export function stopWaveScheduler(): void {
  if (_schedulerInterval) {
    clearInterval(_schedulerInterval);
    _schedulerInterval = null;
  }
}
