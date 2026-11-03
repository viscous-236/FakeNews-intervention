/** Detection side effects. Predictions never create assessments or score events. */

import { type PoolClient } from '../db/pool.js';
import { type NotificationItem } from '../modules/notifications/service.js';

export async function notifyLikelyFake(
  tx: PoolClient,
  postId: string,
  detectionId: string,
): Promise<{ userId: string; item: NotificationItem } | null> {
  const result = await tx.query<{
    id: string;
    user_id: string;
    post_id: string;
    payload: Record<string, unknown>;
    created_at: Date;
  }>(
    `INSERT INTO notifications (user_id, type, post_id, payload)
     SELECT p.author_id, 'post_flagged', p.id, $2::jsonb
     FROM posts p
      WHERE p.id = $1
        AND p.status <> 'deleted'
        AND EXISTS (SELECT 1 FROM post_latest_detection_v d WHERE d.id = $3 AND d.post_id = p.id)
       AND NOT EXISTS (
         SELECT 1 FROM notifications n
         WHERE n.user_id = p.author_id AND n.post_id = p.id
           AND n.type = 'post_flagged'
            AND n.payload->>'detectionId' = $3::text
        ) RETURNING id, user_id, post_id, payload, created_at`,
    [postId, JSON.stringify({ band: 'likely_fake', detectionId }), detectionId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    userId: row.user_id,
    item: {
      id: row.id,
      type: 'post_flagged',
      actor: null,
      postId: row.post_id,
      payload: row.payload,
      createdAt: row.created_at.toISOString(),
      readAt: null,
    },
  };
}
