/** Administrator review queue and post inspection endpoints. */

import { NextFunction, Request, Response, Router } from 'express';
import { listPostsQuerySchema } from '@app/shared';
import { z } from 'zod';
import { getPool } from '../../db/pool.js';
import { withTransaction } from '../../db/tx.js';
import { requireAdmin } from '../../middleware/auth.js';
import { AppError } from '../../middleware/errors.js';
import { validate } from '../../middleware/validate.js';
import { getPostById } from '../posts/service.js';
import { retractReshareEventOnDelete } from '../../scoring/events.js';
import { finalizeWave } from '../../scoring/finalizeWave.js';
import { verifyScores } from '../../scoring/verify.js';
import { decodeCursor, encodeCursor } from '../../db/cursor.js';
import { softDeletePostRow, findPostById } from '../posts/repo.js';

export const adminRouter = Router();
const idParams = z.object({ id: z.string().uuid() }).strict();
const adminListQuery = z
  .object({
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
const userListQuery = adminListQuery
  .extend({
    q: z.string().trim().min(1).max(100).optional(),
    status: z.enum(['active', 'suspended', 'deleted']).optional(),
  })
  .strict();
const auditQuery = adminListQuery
  .extend({ action: z.string().trim().min(1).max(100).optional() })
  .strict();

function serializeAdminUser(row: {
  id: string;
  username: string;
  email: string;
  display_name: string;
  role: string;
  status: string;
  sigma: string;
  q: string;
  email_verified_at: Date | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}) {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    sigma: row.sigma,
    q: row.q,
    emailVerified: row.email_verified_at !== null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    deletedAt: row.deleted_at?.toISOString() ?? null,
  };
}

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
  validate({ params: idParams }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const post = await getPostById(req.params.id as string, {
        id: req.user!.id,
        role: 'admin',
      });
      const pool = getPool();
      const [detections, reports, assessments, events, appeals] = await Promise.all([
        pool.query(`SELECT * FROM detection_results WHERE post_id = $1 ORDER BY created_at DESC`, [
          req.params.id,
        ]),
        pool.query(`SELECT * FROM reports WHERE post_id = $1 ORDER BY created_at DESC`, [
          req.params.id,
        ]),
        pool.query(`SELECT * FROM assessments WHERE post_id = $1 ORDER BY created_at DESC`, [
          req.params.id,
        ]),
        pool.query(`SELECT * FROM reputation_events WHERE post_id = $1 ORDER BY created_at DESC`, [
          req.params.id,
        ]),
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
  validate({ params: idParams }),
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

adminRouter.delete(
  '/admin/posts/:id',
  requireAdmin,
  validate({ params: idParams }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await withTransaction(async (tx) => {
        const post = await findPostById(req.params.id as string, tx);
        if (!post || post.status === 'deleted' || post.deleted_at !== null) {
          throw new AppError(404, 'NOT_FOUND', 'Post not found');
        }
        await softDeletePostRow(post.id, tx);
        if (post.kind === 'reshare' && post.reshare_of_post_id) {
          await retractReshareEventOnDelete(tx, post.author_id, post.reshare_of_post_id);
        }
        await tx.query(
          `INSERT INTO admin_audit_log (actor_id, actor_kind, action, entity_type, entity_id, after)
           VALUES ($1, 'admin', 'post.delete', 'post', $2, $3)`,
          [req.user!.id, post.id, JSON.stringify({ status: 'deleted' })],
        );
      });
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);

adminRouter.get(
  '/admin/users',
  requireAdmin,
  validate({ query: userListQuery }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = req.query as unknown as z.infer<typeof userListQuery>;
      const cursor = query.cursor ? decodeCursor(query.cursor) : null;
      const result = await getPool().query<Parameters<typeof serializeAdminUser>[0]>(
        `SELECT id, username, email, display_name, role, status, sigma::text, q::text,
                email_verified_at, created_at, updated_at, deleted_at
         FROM users
         WHERE ($1::text IS NULL OR status = $1)
           AND ($2::text IS NULL OR username ILIKE '%' || $2 || '%' OR display_name ILIKE '%' || $2 || '%')
           AND ($3::timestamptz IS NULL OR (date_trunc('milliseconds', created_at), id) < ($3, $4::uuid))
         ORDER BY date_trunc('milliseconds', created_at) DESC, id DESC
         LIMIT $5`,
        [
          query.status ?? null,
          query.q ?? null,
          cursor?.createdAt ?? null,
          cursor?.id ?? null,
          query.limit + 1,
        ],
      );
      const rows = result.rows.slice(0, query.limit);
      const last = rows.at(-1);
      res.json({
        items: rows.map(serializeAdminUser),
        nextCursor:
          result.rows.length > query.limit && last ? encodeCursor(last.created_at, last.id) : null,
      });
    } catch (error) {
      next(error);
    }
  },
);

adminRouter.get(
  '/admin/users/:id',
  requireAdmin,
  validate({ params: idParams }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const pool = getPool();
      const user = await pool.query<Parameters<typeof serializeAdminUser>[0]>(
        `SELECT id, username, email, display_name, role, status, sigma::text, q::text,
                email_verified_at, created_at, updated_at, deleted_at
         FROM users WHERE id = $1`,
        [req.params.id],
      );
      const row = user.rows[0];
      if (!row) throw new AppError(404, 'NOT_FOUND', 'User not found');
      const [counts, posts, events, appeals] = await Promise.all([
        pool.query(
          `SELECT
          (SELECT count(*)::int FROM posts WHERE author_id = $1) AS posts,
          (SELECT count(*)::int FROM follows WHERE followee_id = $1) AS followers,
          (SELECT count(*)::int FROM follows WHERE follower_id = $1) AS following`,
          [row.id],
        ),
        pool.query(
          `SELECT id, kind, status, created_at FROM posts WHERE author_id = $1 ORDER BY created_at DESC LIMIT 50`,
          [row.id],
        ),
        pool.query(
          `SELECT id, post_id, kind, value, status, void_reason, created_at FROM reputation_events WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`,
          [row.id],
        ),
        pool.query(
          `SELECT id, event_id, status, reason, created_at, resolved_at FROM appeals WHERE appellant_id = $1 ORDER BY created_at DESC LIMIT 100`,
          [row.id],
        ),
      ]);
      res.json({
        user: serializeAdminUser(row),
        counts: counts.rows[0],
        posts: posts.rows,
        events: events.rows,
        appeals: appeals.rows,
      });
    } catch (error) {
      next(error);
    }
  },
);

async function changeUserStatus(
  req: Request,
  res: Response,
  next: NextFunction,
  status: 'active' | 'suspended',
): Promise<void> {
  try {
    await withTransaction(async (tx) => {
      const result = await tx.query<{ id: string; status: string }>(
        `UPDATE users SET status = $2, updated_at = now()
         WHERE id = $1 AND status <> 'deleted' RETURNING id, status`,
        [req.params.id, status],
      );
      if (!result.rows[0]) throw new AppError(404, 'NOT_FOUND', 'User not found');
      if (status === 'suspended')
        await tx.query('DELETE FROM sessions WHERE user_id = $1', [req.params.id]);
      await tx.query(
        `INSERT INTO admin_audit_log (actor_id, actor_kind, action, entity_type, entity_id, after)
         VALUES ($1, 'admin', $2, 'user', $3, $4)`,
        [
          req.user!.id,
          status === 'suspended' ? 'user.suspend' : 'user.unsuspend',
          req.params.id,
          JSON.stringify({ status }),
        ],
      );
    });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

adminRouter.post(
  '/admin/users/:id/suspend',
  requireAdmin,
  validate({ params: idParams }),
  (req, res, next) => {
    void changeUserStatus(req, res, next, 'suspended');
  },
);
adminRouter.post(
  '/admin/users/:id/unsuspend',
  requireAdmin,
  validate({ params: idParams }),
  (req, res, next) => {
    void changeUserStatus(req, res, next, 'active');
  },
);

adminRouter.get(
  '/admin/audit',
  requireAdmin,
  validate({ query: auditQuery }),
  async (req, res, next) => {
    try {
      const query = req.query as unknown as z.infer<typeof auditQuery>;
      const cursor = query.cursor ? decodeCursor(query.cursor) : null;
      const result = await getPool().query(
        `SELECT id, actor_id, actor_kind, action, entity_type, entity_id, before, after, created_at
         FROM admin_audit_log
         WHERE ($1::text IS NULL OR action = $1)
           AND ($2::timestamptz IS NULL OR (date_trunc('milliseconds', created_at), id) < ($2, $3::uuid))
         ORDER BY date_trunc('milliseconds', created_at) DESC, id DESC LIMIT $4`,
        [query.action ?? null, cursor?.createdAt ?? null, cursor?.id ?? null, query.limit + 1],
      );
      const rows = result.rows.slice(0, query.limit);
      const last = rows.at(-1);
      res.json({
        items: rows,
        nextCursor:
          result.rows.length > query.limit && last ? encodeCursor(last.created_at, last.id) : null,
      });
    } catch (error) {
      next(error);
    }
  },
);

adminRouter.get(
  '/admin/waves',
  requireAdmin,
  validate({ query: adminListQuery }),
  async (req, res, next) => {
    try {
      const query = req.query as unknown as z.infer<typeof adminListQuery>;
      const cursor = query.cursor ? decodeCursor(query.cursor) : null;
      const result = await getPool().query(
        `SELECT id, number, status, formula_version, opened_at, finalized_at, finalized_by, finalized_by_system
         FROM waves WHERE ($1::timestamptz IS NULL OR (opened_at, id) < ($1, $2::uuid))
         ORDER BY opened_at DESC, id DESC LIMIT $3`,
        [cursor?.createdAt ?? null, cursor?.id ?? null, query.limit + 1],
      );
      const rows = result.rows.slice(0, query.limit);
      const last = rows.at(-1);
      res.json({
        items: rows,
        nextCursor:
          result.rows.length > query.limit && last ? encodeCursor(last.opened_at, last.id) : null,
      });
    } catch (error) {
      next(error);
    }
  },
);

adminRouter.get(
  '/admin/waves/:id/ledger',
  requireAdmin,
  validate({ params: idParams, query: adminListQuery }),
  async (req, res, next) => {
    try {
      const query = req.query as unknown as z.infer<typeof adminListQuery>;
      const cursor = query.cursor ? decodeCursor(query.cursor) : null;
      const pool = getPool();
      const wave = await pool.query('SELECT id FROM waves WHERE id = $1', [req.params.id]);
      if (!wave.rows[0]) throw new AppError(404, 'NOT_FOUND', 'Wave not found');
      const result = await pool.query(
        `SELECT uwr.*, u.username FROM user_wave_reputation uwr JOIN users u ON u.id = uwr.user_id
         WHERE uwr.wave_id = $1 AND ($2::timestamptz IS NULL OR (uwr.created_at, uwr.user_id) < ($2, $3::uuid))
         ORDER BY uwr.created_at DESC, uwr.user_id DESC LIMIT $4`,
        [req.params.id, cursor?.createdAt ?? null, cursor?.id ?? null, query.limit + 1],
      );
      const rows = result.rows.slice(0, query.limit);
      const last = rows.at(-1);
      res.json({
        items: rows,
        nextCursor:
          result.rows.length > query.limit && last
            ? encodeCursor(last.created_at, last.user_id)
            : null,
      });
    } catch (error) {
      next(error);
    }
  },
);

adminRouter.post(
  '/admin/waves/:id/finalize',
  requireAdmin,
  validate({ params: idParams }),
  async (req, res, next) => {
    try {
      res.json(
        await finalizeWave(req.params.id as string, { kind: 'admin', userId: req.user!.id }),
      );
    } catch (error) {
      next(error);
    }
  },
);

adminRouter.post('/admin/verify-scores', requireAdmin, async (req, res, next) => {
  try {
    const result = await withTransaction(async (tx) => {
      const verification = await verifyScores(tx);
      await tx.query(
        `INSERT INTO admin_audit_log (actor_id, actor_kind, action, entity_type, after)
           VALUES ($1, 'admin', 'scores.verify', 'scores', $2)`,
        [req.user!.id, JSON.stringify({ ok: verification.ok, issues: verification.issues.length })],
      );
      return verification;
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});
