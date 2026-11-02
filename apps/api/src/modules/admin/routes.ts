/** Administrator review queue and post inspection endpoints. */

import { NextFunction, Request, Response, Router } from 'express';
import { listPostsQuerySchema } from '@app/shared';
import { getPool } from '../../db/pool.js';
import { withTransaction } from '../../db/tx.js';
import { requireAdmin } from '../../middleware/auth.js';
import { AppError } from '../../middleware/errors.js';
import { validate } from '../../middleware/validate.js';
import { getPostById } from '../posts/service.js';

export const adminRouter = Router();

adminRouter.get(
  '/admin/queue',
  requireAdmin,
  validate({ query: listPostsQuerySchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = req.query as unknown as { limit?: number };
      const limit = query.limit ?? 20;
      const pool = getPool();
      const result = await pool.query<{
        post_id: string;
        priority: string;
        open_reports: string;
        reshares: string;
        reasons: string[];
      }>(
        `SELECT q.post_id, q.priority, rp.open_reports, rs.reshares,
           array_remove(ARRAY[
             CASE WHEN rp.open_reports > 0 THEN 'reported' END,
             CASE WHEN d.band = 'likely_fake' THEN 'likely_fake' END,
             CASE WHEN d.band = 'uncertain' THEN 'uncertain' END,
             CASE WHEN d.status = 'failed_permanent' THEN 'detector_failed' END,
             CASE WHEN p.status = 'held' THEN 'held' END
           ], NULL) AS reasons
         FROM review_queue_v q
         JOIN posts p ON p.id = q.post_id
         LEFT JOIN post_latest_detection_v d ON d.post_id = q.post_id
         LEFT JOIN LATERAL (
           SELECT count(*)::int AS open_reports
           FROM reports r WHERE r.post_id = q.post_id AND r.status = 'open'
         ) rp ON true
         LEFT JOIN LATERAL (
           SELECT count(*)::int AS reshares
           FROM posts s WHERE s.reshare_of_post_id = q.post_id
             AND s.kind = 'reshare' AND s.status <> 'deleted'
         ) rs ON true
         ORDER BY q.priority DESC, q.created_at ASC, q.post_id ASC
         LIMIT $1`,
        [limit],
      );

      const items = await Promise.all(
        result.rows.map(async (row) => ({
          post: await getPostById(row.post_id, { id: req.user!.id, role: 'admin' }),
          priority: Number(row.priority),
          openReports: Number(row.open_reports),
          reshares: Number(row.reshares),
          reasons: row.reasons ?? [],
        })),
      );
      res.status(200).json({ items, nextCursor: null });
    } catch (error) {
      next(error);
    }
  },
);

adminRouter.get(
  '/admin/posts/:id',
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const post = await getPostById(req.params.id as string, {
        id: req.user!.id,
        role: 'admin',
      });
      const pool = getPool();
      const [detections, reports, assessments, events, appeals] = await Promise.all([
        pool.query(`SELECT * FROM detection_results WHERE post_id = $1 ORDER BY created_at DESC`, [req.params.id]),
        pool.query(`SELECT * FROM reports WHERE post_id = $1 ORDER BY created_at DESC`, [req.params.id]),
        pool.query(`SELECT * FROM assessments WHERE post_id = $1 ORDER BY created_at DESC`, [req.params.id]),
        pool.query(`SELECT * FROM reputation_events WHERE post_id = $1 ORDER BY created_at DESC`, [req.params.id]),
        pool.query(
          `SELECT ap.* FROM appeals ap
           JOIN reputation_events e ON e.id = ap.event_id
           WHERE e.post_id = $1 ORDER BY ap.created_at DESC`,
          [req.params.id],
        ),
      ]);
      res.status(200).json({
        post,
        detections: detections.rows,
        reports: reports.rows,
        assessments: assessments.rows,
        events: events.rows,
        appeals: appeals.rows,
      });
    } catch (error) {
      next(error);
    }
  },
);

adminRouter.post(
  '/admin/posts/:id/release',
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await withTransaction(async (tx) => {
        const result = await tx.query<{ id: string }>(
          `UPDATE posts SET status = 'published'
           WHERE id = $1 AND status = 'held' AND deleted_at IS NULL
           RETURNING id`,
          [req.params.id],
        );
        if (!result.rows[0]) throw new AppError(404, 'NOT_FOUND', 'Held post not found');
        await tx.query(
          `INSERT INTO admin_audit_log (actor_id, actor_kind, action, entity_type, entity_id, after)
           VALUES ($1, 'admin', 'post.release', 'post', $2, $3)`,
          [req.user!.id, req.params.id, JSON.stringify({ status: 'published' })],
        );
      });
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);
