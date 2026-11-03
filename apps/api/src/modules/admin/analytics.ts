/** Credibility spread analytics (TASK-070). */

import { getPool } from '../../db/pool.js';

export interface SpreadRow {
  waveNumber: number;
  authorTier: 'trusted' | 'neutral' | 'low';
  reshares: { before: number; after: number };
  likes: { before: number; after: number };
}

export async function getSpreadAnalytics(): Promise<{ items: SpreadRow[] }> {
  const result = await getPool().query<{
    wave_number: number;
    author_tier: 'trusted' | 'neutral' | 'low';
    reshares_before: string;
    reshares_after: string;
    likes_before: string;
    likes_after: string;
  }>(
    `WITH labeled_posts AS (
       SELECT p.id, p.author_tier_at_post AS author_tier, a.created_at AS label_time,
              COALESCE(w.number, 0) AS wave_number
         FROM posts p
         JOIN assessments a
           ON a.post_id = p.id AND a.is_current AND a.source = 'admin'
         LEFT JOIN waves w
           ON a.created_at >= w.opened_at
          AND (w.finalized_at IS NULL OR a.created_at < w.finalized_at)
        WHERE p.kind = 'original'
     )
     SELECT wave_number,
            author_tier,
            COALESCE(SUM((SELECT count(*) FROM posts r
                           WHERE r.reshare_of_post_id = lp.id
                             AND r.kind = 'reshare'
                             AND r.status <> 'deleted'
                             AND r.deleted_at IS NULL
                             AND r.created_at < lp.label_time)), 0)::int AS reshares_before,
            COALESCE(SUM((SELECT count(*) FROM posts r
                           WHERE r.reshare_of_post_id = lp.id
                             AND r.kind = 'reshare'
                             AND r.status <> 'deleted'
                             AND r.deleted_at IS NULL
                             AND r.created_at >= lp.label_time)), 0)::int AS reshares_after,
            COALESCE(SUM((SELECT count(*) FROM likes l
                           WHERE l.post_id = lp.id
                             AND l.deleted_at IS NULL
                             AND l.updated_at < lp.label_time)), 0)::int AS likes_before,
            COALESCE(SUM((SELECT count(*) FROM likes l
                           WHERE l.post_id = lp.id
                             AND l.deleted_at IS NULL
                             AND l.updated_at >= lp.label_time)), 0)::int AS likes_after
       FROM labeled_posts lp
      GROUP BY wave_number, author_tier
      ORDER BY wave_number ASC,
               CASE author_tier WHEN 'trusted' THEN 1 WHEN 'neutral' THEN 2 ELSE 3 END`,
  );

  return {
    items: result.rows.map((row) => ({
      waveNumber: Number(row.wave_number),
      authorTier: row.author_tier,
      reshares: {
        before: Number(row.reshares_before),
        after: Number(row.reshares_after),
      },
      likes: {
        before: Number(row.likes_before),
        after: Number(row.likes_after),
      },
    })),
  };
}
