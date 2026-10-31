/**
 * apps/api/src/jobs/mediaCleanup.ts (TASK-041)
 *
 * Background job to purge unreferenced orphaned media from S3 and database.
 */

import { withTransaction } from '../db/tx.js';
import { logger } from '../logger.js';
import { deleteObject } from '../storage/s3.js';
import { findOrphanedMedia, deleteMedia } from '../modules/media/repo.js';

export const MEDIA_CLEANUP_LOCK_ID = 42004;

/**
 * Remove orphaned media unreferenced for more than olderThanHours.
 */
export async function cleanupOrphanedMedia(olderThanHours = 24): Promise<number> {
  return withTransaction(async (tx) => {
    // Transaction-scoped non-blocking advisory lock
    const lockRes = await tx.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_xact_lock($1) AS locked`,
      [MEDIA_CLEANUP_LOCK_ID],
    );

    if (!lockRes.rows[0]?.locked) {
      return 0;
    }

    const orphans = await findOrphanedMedia(olderThanHours, tx);
    if (orphans.length === 0) {
      return 0;
    }

    let purgedCount = 0;
    for (const orphan of orphans) {
      try {
        await deleteObject(orphan.object_key);
        await deleteMedia(orphan.id, tx);
        purgedCount += 1;
      } catch (err) {
        logger.error(
          { mediaId: orphan.id, objectKey: orphan.object_key, err },
          'Failed to cleanup orphaned media item',
        );
      }
    }

    return purgedCount;
  });
}

let _cleanupInterval: NodeJS.Timeout | null = null;

export function startMediaCleanup(intervalMs = 60 * 60 * 1000): void {
  if (_cleanupInterval) return;

  _cleanupInterval = setInterval(async () => {
    try {
      await cleanupOrphanedMedia();
    } catch (err) {
      logger.error({ err }, 'Error in media cleanup background loop');
    }
  }, intervalMs);

  _cleanupInterval.unref();
}

export function stopMediaCleanup(): void {
  if (_cleanupInterval) {
    clearInterval(_cleanupInterval);
    _cleanupInterval = null;
  }
}
