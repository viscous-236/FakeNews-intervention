/** Administrator review queue, post inspection, users, waves, audit and analytics endpoints. */

import { NextFunction, Request, Response, Router } from 'express';
import {
  listPostsQuerySchema,
  adminListQuerySchema,
  userListQuerySchema,
  auditQuerySchema,
  exportQuerySchema,
  suspendUserSchema,
  adminDeletePostSchema,
} from '@app/shared';
import { z } from 'zod';
import { config } from '../../config.js';
import { getPool } from '../../db/pool.js';
import { withTransaction } from '../../db/tx.js';
import { requireAdmin } from '../../middleware/auth.js';
import { AppError } from '../../middleware/errors.js';
import { validate } from '../../middleware/validate.js';
import { getPostById } from '../posts/service.js';
import { retractReshareEventOnDelete } from '../../scoring/events.js';
import { finalizeWave } from '../../scoring/finalizeWave.js';
import { verifyScores } from '../../scoring/verify.js';
import { tierOfValue } from '../../scoring/tier.js';
import { decodeCursor, encodeCursor } from '../../db/cursor.js';
import { softDeletePostRow, findPostById } from '../posts/repo.js';
import { decimalString } from '../score/service.js';
import {
  getOverviewAnalytics,
  getDetectorAnalytics,
  getWavesAnalytics,
  getSpreadAnalytics,
} from './analytics.js';
import { exportLedgerCsv, exportEventsCsv, exportAssessmentsCsv } from './export.js';

export const adminRouter = Router();
const idParams = z.object({ id: z.string().uuid() }).strict();
const adminListQuery = adminListQuerySchema;
const userListQuery = userListQuerySchema;
const auditQuery = auditQuerySchema;
const exportQuery = exportQuerySchema;

const iso = (d: Date | string | null | undefined): string | null =>
  d === null || d === undefined ? null : new Date(d).toISOString();

function avatarUrl(mediaId: string | null): string | null {
  return mediaId ? `${config.S3_PUBLIC_BASE_URL}/${mediaId}` : null;
}

// ---------------------------------------------------------------------------
// Analytics and exports
// ---------------------------------------------------------------------------

adminRouter.get('/admin/analytics/overview', requireAdmin, async (_req, res, next) => {
  try {
    res.json(await getOverviewAnalytics());
  } catch (error) {
    next(error);
  }
});

adminRouter.get('/admin/analytics/detector', requireAdmin, async (_req, res, next) => {
  try {
    res.json(await getDetectorAnalytics());
  } catch (error) {
    next(error);
  }
});

adminRouter.get('/admin/analytics/waves', requireAdmin, async (_req, res, next) => {
  try {
    res.json(await getWavesAnalytics());
  } catch (error) {
    next(error);
  }
});

adminRouter.get('/admin/analytics/spread', requireAdmin, async (_req, res, next) => {
  try {
    res.json(await getSpreadAnalytics());
  } catch (error) {
    next(error);
  }
});

function csvRoute(filename: string, produce: (waveNumber?: number) => Promise<string>) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = req.query as unknown as { waveNumber?: number };
      const csv = await produce(query.waveNumber);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.status(200).send(csv);
    } catch (error) {
      next(error);
    }
  };
}

adminRouter.get(
  '/admin/export/ledger.csv',
  requireAdmin,
  validate({ query: exportQuery }),
  csvRoute('ledger.csv', exportLedgerCsv),
);
adminRouter.get(
  '/admin/export/events.csv',
  requireAdmin,
  validate({ query: exportQuery }),
  csvRoute('events.csv', exportEventsCsv),
);
adminRouter.get(
  '/admin/export/assessments.csv',
  requireAdmin,
  validate({ query: exportQuery }),
  csvRoute('assessments.csv', exportAssessmentsCsv),
);

// ---------------------------------------------------------------------------
// Review queue and post inspection
// ---------------------------------------------------------------------------

interface QueueRow {
  post_id: string;
  priority: string;
  created_at: Date;
  open_reports: string;
  reshares: string;
  reasons: string[];
}

adminRouter.get(
  '/admin/queue',
  requireAdmin,
  validate({ query: listPostsQuerySchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = req.query as unknown as { limit?: number; cursor?: string };
      const limit = query.limit ?? 20;
      const cursor = query.cursor ? decodeCursor(query.cursor) : null;
      const pool = getPool();
      // Keyset over (priority DESC, created_at ASC, post_id ASC); the cursor
      // carries the last row's created_at and id, and its priority is re-read.
      const result = await pool.query<QueueRow>(
        `WITH after AS (
           SELECT priority FROM review_queue_v WHERE post_id = $2::uuid
         )
         SELECT q.post_id, q.priority, q.created_at, rp.open_reports, rs.reshares,
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
         WHERE $2::uuid IS NULL
            OR NOT EXISTS (SELECT 1 FROM after)
            OR q.priority < (SELECT priority FROM after)
            OR (q.priority = (SELECT priority FROM after)
                AND (q.created_at > $3::timestamptz
                     OR (q.created_at = $3::timestamptz AND q.post_id > $2::uuid)))
         ORDER BY q.priority DESC, q.created_at ASC, q.post_id ASC
         LIMIT $1`,
        [limit + 1, cursor?.id ?? null, cursor?.createdAt ?? null],
      );

      const rows = result.rows.slice(0, limit);
      const last = rows.at(-1);
      const items = await Promise.all(
        rows.map(async (row) => ({
          post: await getPostById(row.post_id, { id: req.user!.id, role: 'admin' }),
          priority: Number(row.priority),
          openReports: Number(row.open_reports),
          reshares: Number(row.reshares),
          reasons: row.reasons ?? [],
        })),
      );
      res.status(200).json({
        items,
        nextCursor:
          result.rows.length > limit && last
            ? encodeCursor(new Date(last.created_at), last.post_id)
            : null,
      });
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
      const postId = req.params.id as string;
      const adminId = req.user!.id;
      const post = await getPostById(postId, { id: adminId, role: 'admin' });
      const pool = getPool();
      const [author, interactors, conflict, detections, reports, assessments, events, appeals] =
        await Promise.all([
          pool.query<{ id: string; username: string; q: string; sigma: string }>(
            `SELECT u.id, u.username, u.q::text, u.sigma::text FROM users u WHERE u.id = $1`,
            [post.author.id],
          ),
          pool.query<{ resharers: string; likers: string; reporters: string }>(
            `SELECT
               (SELECT count(*) FROM posts r
                 WHERE r.reshare_of_post_id = $1 AND r.kind = 'reshare' AND r.status <> 'deleted'
                   AND r.author_id <> $2) AS resharers,
               (SELECT count(*) FROM likes l
                 WHERE l.post_id = $1 AND l.deleted_at IS NULL AND l.user_id <> $2) AS likers,
               (SELECT count(*) FROM reports rp
                 WHERE rp.post_id = $1 AND rp.reporter_id <> $2
                   AND NOT EXISTS (
                     SELECT 1 FROM reputation_events e
                      WHERE e.post_id = $1 AND e.user_id = rp.reporter_id AND e.kind = 'VALID_REPORT'
                        AND e.status <> 'voided'
                   )) AS reporters`,
            [postId, post.author.id],
          ),
          pool.query<{ conflict: boolean }>(
            `SELECT (
               EXISTS (SELECT 1 FROM posts WHERE id = $1 AND author_id = $2)
               OR EXISTS (SELECT 1 FROM posts r WHERE r.reshare_of_post_id = $1 AND r.author_id = $2)
               OR EXISTS (SELECT 1 FROM reports WHERE post_id = $1 AND reporter_id = $2)
               OR EXISTS (SELECT 1 FROM likes WHERE post_id = $1 AND user_id = $2)
             ) AS conflict`,
            [postId, adminId],
          ),
          pool.query(
            `SELECT id, post_revision, status, attempts, band, p_fake::text AS p_fake, model_name, model_version,
                    latency_ms, error_code, created_at, completed_at
             FROM detection_results WHERE post_id = $1 ORDER BY created_at DESC`,
            [postId],
          ),
          pool.query(
            `SELECT r.id, r.reason, r.details, r.status, r.created_at,
                    u.id AS reporter_id, u.username, u.display_name, u.avatar_media_id, u.q::text AS q
             FROM reports r JOIN users u ON u.id = r.reporter_id
             WHERE r.post_id = $1 ORDER BY r.created_at DESC`,
            [postId],
          ),
          pool.query(
            `SELECT id, verdict, source, decided_by, rationale, is_current, supersedes_id, created_at
             FROM assessments WHERE post_id = $1 ORDER BY created_at DESC`,
            [postId],
          ),
          pool.query(
            `SELECT e.id, e.user_id, u.username, e.kind, e.value, e.status, e.void_reason, e.created_at
             FROM reputation_events e JOIN users u ON u.id = e.user_id
             WHERE e.post_id = $1 ORDER BY e.created_at DESC`,
            [postId],
          ),
          pool.query(
            `SELECT ap.id, ap.event_id, ap.appellant_id, ap.status, ap.reason, ap.resolution_note,
                    ap.created_at, ap.resolved_at
             FROM appeals ap JOIN reputation_events e ON e.id = ap.event_id
             WHERE e.post_id = $1 ORDER BY ap.created_at DESC`,
            [postId],
          ),
        ]);
      const a = author.rows[0];
      if (!a) throw new AppError(404, 'NOT_FOUND', 'Post not found');
      const counts = interactors.rows[0]!;
      res.status(200).json({
        post,
        author: {
          id: a.id,
          username: a.username,
          q: decimalString(a.q),
          sigma: decimalString(a.sigma),
          tier: tierOfValue(a.q),
        },
        interactors: {
          resharers: Number(counts.resharers),
          likers: Number(counts.likers),
          reporters: Number(counts.reporters),
        },
        conflictOfInterest: Boolean(conflict.rows[0]?.conflict),
        detections: detections.rows.map((d) => ({
          id: d.id,
          postRevision: d.post_revision,
          status: d.status,
          attempts: d.attempts,
          band: d.band,
          pFake: d.p_fake,
          modelName: d.model_name,
          modelVersion: d.model_version,
          latencyMs: d.latency_ms,
          errorCode: d.error_code,
          createdAt: iso(d.created_at),
          completedAt: iso(d.completed_at),
        })),
        reports: reports.rows.map((r) => ({
          id: r.id,
          reporter: {
            id: r.reporter_id,
            username: r.username,
            displayName: r.display_name,
            avatarUrl: avatarUrl(r.avatar_media_id),
            tier: tierOfValue(r.q),
          },
          reason: r.reason,
          details: r.details,
          status: r.status,
          createdAt: iso(r.created_at),
        })),
        assessments: assessments.rows.map((s) => ({
          id: s.id,
          verdict: s.verdict,
          source: s.source,
          decidedBy: s.decided_by,
          rationale: s.rationale,
          isCurrent: s.is_current,
          supersedesId: s.supersedes_id,
          createdAt: iso(s.created_at),
        })),
        events: events.rows.map((e) => ({
          id: e.id,
          userId: e.user_id,
          username: e.username,
          kind: e.kind,
          value: e.value,
          status: e.status,
          voidReason: e.void_reason,
          createdAt: iso(e.created_at),
        })),
        appeals: appeals.rows.map((ap) => ({
          id: ap.id,
          eventId: ap.event_id,
          appellantId: ap.appellant_id,
          status: ap.status,
          reason: ap.reason,
          resolutionNote: ap.resolution_note,
          createdAt: iso(ap.created_at),
          resolvedAt: iso(ap.resolved_at),
        })),
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
          `INSERT INTO admin_audit_log (actor_id, actor_kind, action, entity_type, entity_id, before, after)
           VALUES ($1, 'admin', 'post.release', 'post', $2, $3, $4)`,
          [
            req.user!.id,
            req.params.id,
            JSON.stringify({ status: 'held' }),
            JSON.stringify({ status: 'published' }),
          ],
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
  validate({ params: idParams, body: adminDeletePostSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const reason = (req.body as { reason: string }).reason;
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
          `INSERT INTO admin_audit_log (actor_id, actor_kind, action, entity_type, entity_id, before, after)
           VALUES ($1, 'admin', 'post.delete', 'post', $2, $3, $4)`,
          [
            req.user!.id,
            post.id,
            JSON.stringify({ status: post.status }),
            JSON.stringify({ status: 'deleted', reason }),
          ],
        );
      });
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

interface AdminUserRow {
  id: string;
  username: string;
  email: string;
  display_name: string;
  avatar_media_id: string | null;
  role: string;
  status: string;
  sigma: string;
  q: string;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

const ADMIN_USER_COLUMNS = `id, username, email, display_name, avatar_media_id, role, status, sigma::text, q::text,
  created_at, updated_at, deleted_at`;

function serializeAdminUser(row: AdminUserRow) {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    displayName: row.display_name,
    avatarUrl: avatarUrl(row.avatar_media_id),
    role: row.role,
    status: row.status,
    sigma: decimalString(row.sigma),
    q: decimalString(row.q),
    tier: tierOfValue(row.q),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    deletedAt: row.deleted_at?.toISOString() ?? null,
  };
}

adminRouter.get(
  '/admin/users',
  requireAdmin,
  validate({ query: userListQuery }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = req.query as unknown as z.infer<typeof userListQuery>;
      const cursor = query.cursor ? decodeCursor(query.cursor) : null;
      const result = await getPool().query<AdminUserRow>(
        `SELECT ${ADMIN_USER_COLUMNS}
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
      const user = await pool.query<AdminUserRow>(
        `SELECT ${ADMIN_USER_COLUMNS} FROM users WHERE id = $1`,
        [req.params.id],
      );
      const row = user.rows[0];
      if (!row) throw new AppError(404, 'NOT_FOUND', 'User not found');
      const [counts, posts, events, appeals, ledger] = await Promise.all([
        pool.query<{ posts: number; followers: number; following: number }>(
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
        pool.query(
          `SELECT w.number AS wave_number, uwr.n_pos, uwr.n_neg, uwr.n_adj, uwr.r,
                  uwr.sigma_used::text AS sigma_used, uwr.q_before::text AS q_before,
                  uwr.delta::text AS delta, uwr.q_after::text AS q_after,
                  uwr.formula_version, w.finalized_at
           FROM user_wave_reputation uwr JOIN waves w ON w.id = uwr.wave_id
           WHERE uwr.user_id = $1 ORDER BY w.number DESC LIMIT 100`,
          [row.id],
        ),
      ]);
      res.json({
        user: serializeAdminUser(row),
        counts: counts.rows[0],
        posts: posts.rows.map((p) => ({
          id: p.id,
          kind: p.kind,
          status: p.status,
          createdAt: iso(p.created_at),
        })),
        events: events.rows.map((e) => ({
          id: e.id,
          postId: e.post_id,
          kind: e.kind,
          value: e.value,
          status: e.status,
          voidReason: e.void_reason,
          createdAt: iso(e.created_at),
        })),
        appeals: appeals.rows.map((ap) => ({
          id: ap.id,
          eventId: ap.event_id,
          status: ap.status,
          reason: ap.reason,
          createdAt: iso(ap.created_at),
          resolvedAt: iso(ap.resolved_at),
        })),
        ledger: ledger.rows.map(serializeLedgerRow),
      });
    } catch (error) {
      next(error);
    }
  },
);

interface LedgerRowDb {
  wave_number: number;
  n_pos: number;
  n_neg: number;
  n_adj: number;
  r: number;
  sigma_used: string;
  q_before: string;
  delta: string;
  q_after: string;
  formula_version: string;
  finalized_at: Date | null;
}

function serializeLedgerRow(row: LedgerRowDb) {
  return {
    waveNumber: row.wave_number,
    nPos: row.n_pos,
    nNeg: row.n_neg,
    nAdj: row.n_adj,
    r: row.r,
    sigmaUsed: decimalString(row.sigma_used),
    qBefore: decimalString(row.q_before),
    delta: decimalString(row.delta),
    qAfter: decimalString(row.q_after),
    formulaVersion: row.formula_version,
    finalizedAt: iso(row.finalized_at),
  };
}

async function changeUserStatus(
  req: Request,
  res: Response,
  next: NextFunction,
  status: 'active' | 'suspended',
): Promise<void> {
  try {
    const reason = (req.body as { reason: string }).reason;
    await withTransaction(async (tx) => {
      const target = await tx.query<{ id: string; role: string; status: string }>(
        `SELECT id, role, status FROM users WHERE id = $1 AND status <> 'deleted' FOR UPDATE`,
        [req.params.id],
      );
      const user = target.rows[0];
      if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found');
      // Section 1.7: admins cannot suspend admins.
      if (user.role === 'admin' && status === 'suspended') {
        throw new AppError(403, 'FORBIDDEN', 'Administrators cannot be suspended');
      }
      await tx.query(`UPDATE users SET status = $2, updated_at = now() WHERE id = $1`, [
        user.id,
        status,
      ]);
      if (status === 'suspended')
        await tx.query('DELETE FROM sessions WHERE user_id = $1', [user.id]);
      await tx.query(
        `INSERT INTO admin_audit_log (actor_id, actor_kind, action, entity_type, entity_id, before, after)
         VALUES ($1, 'admin', $2, 'user', $3, $4, $5)`,
        [
          req.user!.id,
          status === 'suspended' ? 'user.suspend' : 'user.unsuspend',
          user.id,
          JSON.stringify({ status: user.status }),
          JSON.stringify({ status, reason }),
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
  validate({ params: idParams, body: suspendUserSchema }),
  (req, res, next) => {
    void changeUserStatus(req, res, next, 'suspended');
  },
);
adminRouter.post(
  '/admin/users/:id/unsuspend',
  requireAdmin,
  validate({ params: idParams, body: suspendUserSchema }),
  (req, res, next) => {
    void changeUserStatus(req, res, next, 'active');
  },
);

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

adminRouter.get(
  '/admin/audit',
  requireAdmin,
  validate({ query: auditQuery }),
  async (req, res, next) => {
    try {
      const query = req.query as unknown as z.infer<typeof auditQuery>;
      const cursor = query.cursor ? decodeCursor(query.cursor) : null;
      const result = await getPool().query<{
        id: string;
        actor_id: string | null;
        actor_kind: 'admin' | 'system';
        action: string;
        entity_type: string;
        entity_id: string | null;
        before: Record<string, unknown> | null;
        after: Record<string, unknown> | null;
        created_at: Date;
      }>(
        `SELECT id, actor_id, actor_kind, action, entity_type, entity_id, before, after, created_at
         FROM admin_audit_log
         WHERE ($1::text IS NULL OR action = $1)
           AND ($2::text IS NULL OR entity_type = $2)
           AND ($3::uuid IS NULL OR entity_id = $3)
           AND ($4::uuid IS NULL OR actor_id = $4)
           AND ($5::timestamptz IS NULL OR (date_trunc('milliseconds', created_at), id) < ($5, $6::uuid))
         ORDER BY date_trunc('milliseconds', created_at) DESC, id DESC LIMIT $7`,
        [
          query.action ?? null,
          query.entityType ?? null,
          query.entityId ?? null,
          query.actorId ?? null,
          cursor?.createdAt ?? null,
          cursor?.id ?? null,
          query.limit + 1,
        ],
      );
      const rows = result.rows.slice(0, query.limit);
      const last = rows.at(-1);
      res.json({
        items: rows.map((r) => ({
          id: r.id,
          actorId: r.actor_id,
          actorKind: r.actor_kind,
          action: r.action,
          entityType: r.entity_type,
          entityId: r.entity_id,
          before: r.before,
          after: r.after,
          createdAt: r.created_at.toISOString(),
        })),
        nextCursor:
          result.rows.length > query.limit && last ? encodeCursor(last.created_at, last.id) : null,
      });
    } catch (error) {
      next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// Waves and ledger
// ---------------------------------------------------------------------------

adminRouter.get(
  '/admin/waves',
  requireAdmin,
  validate({ query: adminListQuery }),
  async (req, res, next) => {
    try {
      const query = req.query as unknown as z.infer<typeof adminListQuery>;
      const cursor = query.cursor ? decodeCursor(query.cursor) : null;
      const result = await getPool().query<{
        id: string;
        number: number;
        status: 'open' | 'finalized';
        formula_version: string;
        opened_at: Date;
        finalized_at: Date | null;
        finalized_by: string | null;
        finalized_by_system: boolean;
        users_scored: number | null;
        events_counted: number | null;
        pending_events: number;
        held_events: number;
      }>(
        `SELECT w.id, w.number, w.status, w.formula_version, w.opened_at, w.finalized_at,
                w.finalized_by, w.finalized_by_system,
                (SELECT count(*)::int FROM user_wave_reputation uwr WHERE uwr.wave_id = w.id) AS users_scored,
                (SELECT count(*)::int FROM reputation_events e WHERE e.wave_id = w.id AND e.status = 'counted') AS events_counted,
                (SELECT count(*)::int FROM reputation_events e WHERE e.wave_id = w.id AND e.status = 'eligible') AS pending_events,
                CASE WHEN w.status = 'open'
                     THEN (SELECT count(*)::int FROM reputation_events e WHERE e.status = 'held')
                     ELSE 0 END AS held_events
         FROM waves w
         WHERE ($1::timestamptz IS NULL OR (w.opened_at, w.id) < ($1, $2::uuid))
         ORDER BY w.opened_at DESC, w.id DESC LIMIT $3`,
        [cursor?.createdAt ?? null, cursor?.id ?? null, query.limit + 1],
      );
      const rows = result.rows.slice(0, query.limit);
      const last = rows.at(-1);
      res.json({
        items: rows.map((w) => ({
          id: w.id,
          number: w.number,
          status: w.status,
          formulaVersion: w.formula_version,
          openedAt: w.opened_at.toISOString(),
          finalizedAt: iso(w.finalized_at),
          finalizedBy: w.finalized_by,
          finalizedBySystem: w.finalized_by_system,
          ...(w.status === 'finalized'
            ? { usersScored: w.users_scored ?? 0, eventsCounted: w.events_counted ?? 0 }
            : { pendingEvents: w.pending_events, heldEvents: w.held_events }),
        })),
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
      const result = await pool.query<
        LedgerRowDb & {
          created_at: Date;
          user_id: string;
          username: string;
          display_name: string;
          avatar_media_id: string | null;
          user_q: string;
        }
      >(
        `SELECT w.number AS wave_number, uwr.n_pos, uwr.n_neg, uwr.n_adj, uwr.r,
                uwr.sigma_used::text AS sigma_used, uwr.q_before::text AS q_before,
                uwr.delta::text AS delta, uwr.q_after::text AS q_after,
                uwr.formula_version, w.finalized_at, uwr.created_at,
                u.id AS user_id, u.username, u.display_name, u.avatar_media_id, u.q::text AS user_q
         FROM user_wave_reputation uwr
         JOIN users u ON u.id = uwr.user_id
         JOIN waves w ON w.id = uwr.wave_id
         WHERE uwr.wave_id = $1 AND ($2::timestamptz IS NULL OR (uwr.created_at, uwr.user_id) < ($2, $3::uuid))
         ORDER BY uwr.created_at DESC, uwr.user_id DESC LIMIT $4`,
        [req.params.id, cursor?.createdAt ?? null, cursor?.id ?? null, query.limit + 1],
      );
      const rows = result.rows.slice(0, query.limit);
      const last = rows.at(-1);
      res.json({
        items: rows.map((r) => ({
          ...serializeLedgerRow(r),
          user: {
            id: r.user_id,
            username: r.username,
            displayName: r.display_name,
            avatarUrl: avatarUrl(r.avatar_media_id),
            tier: tierOfValue(r.user_q),
          },
        })),
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
