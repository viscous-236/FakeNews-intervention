/** Administrator queue operations. These never alter assessments or scores. */
import { withTransaction } from '../db/tx.js';
import { AppError } from '../middleware/errors.js';
import { queueDetectionResult } from '../modules/posts/repo.js';
import { checkDetectorHealth, getDetectorModelInfo } from './client.js';
import { config } from '../config.js';

export async function redetectPost(postId: string, actorId: string): Promise<string> {
  return withTransaction(async (tx) => {
    const result = await tx.query<{ revision: number; kind: string }>(
      `SELECT revision, kind FROM posts WHERE id = $1 FOR UPDATE`,
      [postId],
    );
    const post = result.rows[0];
    if (!post) throw new AppError(404, 'NOT_FOUND', 'Post not found');
    if (post.kind !== 'original') {
      throw new AppError(400, 'VALIDATION_ERROR', 'Detect the original post, not its reshare');
    }
    const detectionId = await queueDetectionResult(postId, post.revision, tx);
    await tx.query(
      `INSERT INTO admin_audit_log (actor_id, actor_kind, action, entity_type, entity_id, after)
       VALUES ($1, 'admin', 'post.redetect', 'post', $2, $3)`,
      [actorId, postId, JSON.stringify({ detectionId, revision: post.revision })],
    );
    return detectionId;
  });
}

export async function requeueDetection(detectionId: string, actorId: string): Promise<void> {
  await withTransaction(async (tx) => {
    const result = await tx.query<{ status: string; attempts: number }>(
      `SELECT status, attempts FROM detection_results WHERE id = $1 FOR UPDATE`,
      [detectionId],
    );
    const detection = result.rows[0];
    if (!detection) throw new AppError(404, 'NOT_FOUND', 'Detection not found');
    if (detection.status !== 'failed_permanent') {
      throw new AppError(409, 'CONFLICT', 'Only permanently failed detections can be requeued');
    }
    await tx.query(
      `UPDATE detection_results SET status = 'queued', attempts = 0, next_attempt_at = now(),
         locked_at = NULL, completed_at = NULL, error_code = NULL, error_detail = NULL,
         p_fake = NULL, band = NULL, model_name = NULL, model_version = NULL,
         latency_ms = NULL, raw_response = NULL
       WHERE id = $1`,
      [detectionId],
    );
    await tx.query(
      `INSERT INTO admin_audit_log
         (actor_id, actor_kind, action, entity_type, entity_id, before, after)
       VALUES ($1, 'admin', 'detection.requeue', 'detection', $2, $3, $4)`,
      [
        actorId,
        detectionId,
        JSON.stringify(detection),
        JSON.stringify({ status: 'queued', attempts: 0 }),
      ],
    );
  });
}

export async function getDetectorStatus() {
  const [health, modelInfo] = await Promise.allSettled([
    checkDetectorHealth({ timeoutMs: config.DETECTOR_TIMEOUT_MS }),
    getDetectorModelInfo(),
  ]);
  return {
    health: health.status === 'fulfilled' ? health.value : { ok: false, modelLoaded: false },
    modelInfo: modelInfo.status === 'fulfilled' ? modelInfo.value : null,
  };
}
