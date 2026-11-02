/** Detection side effects. Predictions never create assessments or score events. */

import { type PoolClient } from '../db/pool.js';

export async function notifyLikelyFake(
  tx: PoolClient,
  postId: string,
  detectionId: string,
): Promise<void> {
  await tx.query(
    `INSERT INTO notifications (user_id, type, post_id, payload)
     SELECT p.author_id, 'post_flagged', p.id, $2::jsonb
     FROM posts p
     WHERE p.id = $1
       AND NOT EXISTS (
         SELECT 1 FROM notifications n
         WHERE n.user_id = p.author_id AND n.post_id = p.id
           AND n.type = 'post_flagged'
           AND n.payload->>'detectionId' = $3
       )`,
    [postId, JSON.stringify({ band: 'likely_fake', detectionId }), detectionId],
  );
}
