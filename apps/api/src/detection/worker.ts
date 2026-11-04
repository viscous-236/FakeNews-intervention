/**
 * Detection queue worker (RUL-026, REQ-009, REQ-039).
 *
 * The worker stores model output only. It never creates assessments or
 * reputation events. Assessments remain the scoring authority.
 */

import { type PoolClient } from '../db/pool.js';
import { withTransaction } from '../db/tx.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { classifyBand } from './bands.js';
import { checkDetectorHealth, DetectorClientError, predict } from './client.js';
import { notifyLikelyFake } from './effects.js';
import { emitNotification } from '../modules/notifications/bus.js';

export const DETECTION_WORKER_LOCK_ID = 42003;
const WARMUP_MAX_AGE_MS = 10 * 60 * 1000;

interface DetectionJob {
  id: string;
  request_id: string;
  post_id: string;
  post_revision: number;
  body: string;
  attempts: number;
  lease: string;
}

let lastSuccessfulDetectorCall = 0;
let workerInterval: NodeJS.Timeout | null = null;
let inFlight: Promise<void> | null = null;

/**
 * RUL-026: a `running` row older than 120 s is reset to `failed` and becomes
 * claimable again at once. The expired lease counts as an attempt so a job
 * that keeps dying mid-flight reaches `failed_permanent` instead of being
 * retried forever.
 */
async function resetStaleRows(tx: PoolClient): Promise<void> {
  await tx.query(
    `UPDATE detection_results
     SET attempts = attempts + 1,
         status = CASE WHEN attempts + 1 >= $1 THEN 'failed_permanent' ELSE 'failed' END,
         completed_at = CASE WHEN attempts + 1 >= $1 THEN now() ELSE NULL END,
         next_attempt_at = now(),
         locked_at = NULL,
         error_code = 'TIMEOUT', error_detail = 'Worker lease expired after 120 seconds'
     WHERE status = 'running'
       AND locked_at < now() - interval '120 seconds'`,
    [config.DETECTOR_MAX_ATTEMPTS],
  );
}

async function claimJob(): Promise<DetectionJob | null> {
  return withTransaction(async (tx) => {
    const lock = await tx.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_xact_lock($1) AS locked`,
      [DETECTION_WORKER_LOCK_ID],
    );
    if (!lock.rows[0]?.locked) return null;

    await resetStaleRows(tx);

    const result = await tx.query<DetectionJob>(
      `SELECT d.id, d.request_id, d.post_id, d.post_revision, d.attempts,
         CASE WHEN d.post_revision = p.revision THEN p.body ELSE r.body END AS body
       FROM detection_results d
       JOIN posts p ON p.id = d.post_id
       LEFT JOIN post_revisions r ON r.post_id = d.post_id AND r.revision = d.post_revision
       WHERE d.status IN ('queued', 'failed')
         AND d.next_attempt_at <= now()
         AND p.kind = 'original'
         AND (d.post_revision = p.revision OR r.post_id IS NOT NULL)
       ORDER BY d.next_attempt_at ASC, d.created_at ASC, d.id ASC
       LIMIT 1
       FOR UPDATE OF d SKIP LOCKED`,
    );
    const job = result.rows[0];
    if (!job) return null;

    const claimed = await tx.query<{ lease: string }>(
      `UPDATE detection_results
       SET status = 'running', locked_at = now(), error_code = NULL, error_detail = NULL
       WHERE id = $1 RETURNING locked_at::text AS lease`,
      [job.id],
    );
    return { ...job, lease: claimed.rows[0]!.lease };
  });
}

async function recordFailure(job: DetectionJob, error: unknown): Promise<void> {
  const errorCode = error instanceof DetectorClientError ? error.errorCode : 'HTTP_5XX';
  const detail = error instanceof Error ? error.message : 'Detector request failed';
  const attempts = job.attempts + 1;
  const permanent = attempts >= config.DETECTOR_MAX_ATTEMPTS;
  const backoffIndex = Math.min(attempts - 1, config.DETECTOR_BACKOFF_SECONDS.length - 1);
  const backoffSeconds = config.DETECTOR_BACKOFF_SECONDS[backoffIndex] ?? 600;

  await withTransaction(async (tx) => {
    await tx.query(
      `UPDATE detection_results
       SET status = $2,
           attempts = $3,
           next_attempt_at = CASE WHEN $2 = 'failed_permanent'
             THEN now() ELSE now() + ($4 || ' seconds')::interval END,
           locked_at = NULL,
           error_code = $5,
           error_detail = $6,
           completed_at = CASE WHEN $2 = 'failed_permanent' THEN now() ELSE NULL END
       WHERE id = $1 AND status = 'running' AND locked_at = $7::timestamptz`,
      [
        job.id,
        permanent ? 'failed_permanent' : 'failed',
        attempts,
        String(backoffSeconds),
        errorCode,
        detail.slice(0, 2000),
        job.lease,
      ],
    );
  });

  logger.warn(
    { detectionId: job.id, errorCode, attempts, permanent },
    'Detector prediction failed',
  );
}

async function recordSuccess(
  job: DetectionJob,
  prediction: {
    requestId: string;
    modelName: string;
    modelVersion: string;
    pFake: number;
    latencyMs?: number;
  },
): Promise<void> {
  const band = classifyBand(prediction.pFake);
  const notification = await withTransaction(async (tx) => {
    const updated = await tx.query(
      `UPDATE detection_results
       SET status = 'ok', locked_at = NULL, p_fake = $2, band = $3,
           model_name = $4, model_version = $5, latency_ms = $6,
           raw_response = $7, error_code = NULL, error_detail = NULL,
           completed_at = now()
       WHERE id = $1 AND status = 'running' AND locked_at = $8::timestamptz`,
      [
        job.id,
        prediction.pFake,
        band,
        prediction.modelName,
        prediction.modelVersion,
        prediction.latencyMs ?? null,
        JSON.stringify({
          request_id: prediction.requestId,
          model_name: prediction.modelName,
          model_version: prediction.modelVersion,
          p_fake: prediction.pFake,
          latency_ms: prediction.latencyMs,
        }),
        job.lease,
      ],
    );

    if (updated.rowCount && band === 'likely_fake') {
      return notifyLikelyFake(tx, job.post_id, job.id);
    }
    return null;
  });
  if (notification) emitNotification(notification.userId, notification.item);
}

async function ensureDetectorReady(): Promise<void> {
  if (Date.now() - lastSuccessfulDetectorCall < WARMUP_MAX_AGE_MS) return;
  const health = await checkDetectorHealth({ timeoutMs: config.DETECTOR_WARMUP_TIMEOUT_MS });
  if (!health.ok || !health.modelLoaded) {
    throw new DetectorClientError('HTTP_5XX', 'Detector model is not ready');
  }
}

export async function runDetectionWorkerOnce(): Promise<boolean> {
  const job = await claimJob();
  if (!job) return false;

  let prediction;
  try {
    await ensureDetectorReady();
    prediction = await predict({
      requestId: job.request_id,
      postId: job.post_id,
      text: job.body,
    });
    lastSuccessfulDetectorCall = Date.now();
  } catch (error) {
    await recordFailure(job, error);
    return true;
  }
  // Persistence errors leave the lease recoverable instead of mislabelling a
  // valid prediction as an inference failure.
  await recordSuccess(job, prediction);
  return true;
}

export function startDetectionWorker(intervalMs = config.DETECTOR_POLL_INTERVAL_MS): void {
  if (workerInterval) return;
  const tick = (): void => {
    if (inFlight) return;
    inFlight = runDetectionWorkerOnce()
      .then(() => undefined)
      .catch((error) => {
        logger.error({ error }, 'Detection worker failed');
      })
      .finally(() => {
        inFlight = null;
      });
  };
  tick();
  workerInterval = setInterval(tick, intervalMs);
  workerInterval.unref();
}

export async function stopDetectionWorker(): Promise<void> {
  if (workerInterval) clearInterval(workerInterval);
  workerInterval = null;
  await inFlight;
}
