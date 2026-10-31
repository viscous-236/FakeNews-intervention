/**
 * apps/api/src/modules/posts/repo.ts (TASK-043, DEC-001, DEC-003, DEC-005)
 *
 * Repository for posts, revisions, media attachments, and detection rows.
 */

import { type PoolClient } from '../../db/pool.js';
import { getPool } from '../../db/pool.js';
import { type DecodedCursor } from '../../db/cursor.js';

export interface PostRow {
  id: string;
  author_id: string;
  kind: 'original' | 'reshare';
  reshare_of_post_id: string | null;
  body: string;
  source_url: string | null;
  revision: number;
  status: 'published' | 'held' | 'deleted';
  author_tier_at_post: 'trusted' | 'neutral' | 'low';
  created_at: Date;
  edited_at: Date | null;
  deleted_at: Date | null;
}

export interface PostAuthorJoinedRow extends PostRow {
  author_username: string;
  author_display_name: string;
  author_avatar_media_id: string | null;
  author_q: string;
}

export interface PostPublicStatusRow {
  label: 'none' | 'auto_flagged' | 'fact_checked_true' | 'fact_checked_false' | 'unverifiable';
  under_appeal: boolean;
}

export interface PostDetectionRow {
  id: string;
  status: 'queued' | 'running' | 'ok' | 'failed' | 'failed_permanent';
  band: 'likely_fake' | 'uncertain' | 'likely_real' | null;
  p_fake: string | null;
  model_name: string | null;
  model_version: string | null;
}

export interface PostImageRow {
  id: string;
  width: number;
  height: number;
}

export interface PostCounts {
  likes: number;
  comments: number;
  reshares: number;
}

export interface PostViewerState {
  liked: boolean;
  reshared: boolean;
}

export interface AuthorEventSummary {
  kind: string;
  value: number;
  status: string;
}

export async function insertPost(
  params: {
    authorId: string;
    kind: 'original' | 'reshare';
    reshareOfPostId?: string | null;
    body: string;
    sourceUrl?: string | null;
    status: 'published' | 'held' | 'deleted';
    authorTier: 'trusted' | 'neutral' | 'low';
  },
  client?: PoolClient,
): Promise<PostAuthorJoinedRow> {
  const executor = client ?? getPool();
  const res = await executor.query<PostAuthorJoinedRow>(
    `WITH inserted AS (
      INSERT INTO posts (
        author_id,
        kind,
        reshare_of_post_id,
        body,
        source_url,
        revision,
        status,
        author_tier_at_post
      ) VALUES ($1, $2, $3, $4, $5, 1, $6, $7)
      RETURNING *
    )
    SELECT
      i.*,
      u.username AS author_username,
      u.display_name AS author_display_name,
      u.avatar_media_id AS author_avatar_media_id,
      u.q AS author_q
    FROM inserted i
    JOIN users u ON u.id = i.author_id`,
    [
      params.authorId,
      params.kind,
      params.reshareOfPostId ?? null,
      params.body,
      params.sourceUrl ?? null,
      params.status,
      params.authorTier,
    ],
  );

  const row = res.rows[0];
  if (!row) {
    throw new Error('Failed to insert post');
  }
  return row;
}

export async function attachMediaToPost(
  postId: string,
  mediaIds: string[],
  client?: PoolClient,
): Promise<void> {
  if (mediaIds.length === 0) return;
  const executor = client ?? getPool();

  for (let i = 0; i < mediaIds.length; i++) {
    await executor.query(
      `INSERT INTO post_media (post_id, media_id, position)
       VALUES ($1, $2, $3)
       ON CONFLICT (post_id, media_id) DO NOTHING`,
      [postId, mediaIds[i], i],
    );
  }
}

export async function queueDetectionResult(
  postId: string,
  postRevision: number,
  client?: PoolClient,
): Promise<string> {
  const executor = client ?? getPool();
  const res = await executor.query<{ id: string }>(
    `INSERT INTO detection_results (post_id, post_revision, status, next_attempt_at)
     VALUES ($1, $2, 'queued', now())
     RETURNING id`,
    [postId, postRevision],
  );
  return res.rows[0]!.id;
}

export async function findPostById(
  id: string,
  client?: PoolClient,
): Promise<PostAuthorJoinedRow | null> {
  const executor = client ?? getPool();
  const res = await executor.query<PostAuthorJoinedRow>(
    `SELECT
      p.*,
      u.username AS author_username,
      u.display_name AS author_display_name,
      u.avatar_media_id AS author_avatar_media_id,
      u.q AS author_q
    FROM posts p
    JOIN users u ON u.id = p.author_id
    WHERE p.id = $1`,
    [id],
  );
  return res.rows[0] ?? null;
}

export async function findPostPublicStatus(
  postId: string,
  client?: PoolClient,
): Promise<PostPublicStatusRow> {
  const executor = client ?? getPool();
  const res = await executor.query<PostPublicStatusRow>(
    `SELECT label, under_appeal FROM post_public_status_v WHERE post_id = $1`,
    [postId],
  );
  const row = res.rows[0];
  return {
    label: row?.label ?? 'none',
    under_appeal: Boolean(row?.under_appeal),
  };
}

export async function findPostLatestDetection(
  postId: string,
  client?: PoolClient,
): Promise<PostDetectionRow | null> {
  const executor = client ?? getPool();
  const res = await executor.query<PostDetectionRow>(
    `SELECT id, status, band, p_fake, model_name, model_version
     FROM post_latest_detection_v
     WHERE post_id = $1`,
    [postId],
  );
  return res.rows[0] ?? null;
}

export async function findPostImages(
  postId: string,
  client?: PoolClient,
): Promise<PostImageRow[]> {
  const executor = client ?? getPool();
  const res = await executor.query<PostImageRow>(
    `SELECT m.id, m.width, m.height
     FROM post_media pm
     JOIN media m ON m.id = pm.media_id
     WHERE pm.post_id = $1
     ORDER BY pm.position ASC`,
    [postId],
  );
  return res.rows;
}

export async function countPostInteractions(
  postId: string,
  client?: PoolClient,
): Promise<PostCounts> {
  const executor = client ?? getPool();
  const res = await executor.query<{
    likes: string;
    comments: string;
    reshares: string;
  }>(
    `SELECT
      (SELECT count(*) FROM likes WHERE post_id = $1 AND deleted_at IS NULL) AS likes,
      (SELECT count(*) FROM comments WHERE post_id = $1) AS comments,
      (SELECT count(*) FROM posts WHERE reshare_of_post_id = $1 AND deleted_at IS NULL AND status <> 'deleted') AS reshares`,
    [postId],
  );
  const row = res.rows[0];
  return {
    likes: parseInt(row?.likes ?? '0', 10),
    comments: parseInt(row?.comments ?? '0', 10),
    reshares: parseInt(row?.reshares ?? '0', 10),
  };
}

export async function findViewerInteractions(
  postId: string,
  viewerId: string,
  client?: PoolClient,
): Promise<PostViewerState> {
  const executor = client ?? getPool();
  const res = await executor.query<{
    liked: boolean;
    reshared: boolean;
  }>(
    `SELECT
      EXISTS(SELECT 1 FROM likes WHERE post_id = $1 AND user_id = $2 AND deleted_at IS NULL) AS liked,
      EXISTS(SELECT 1 FROM posts WHERE reshare_of_post_id = $1 AND author_id = $2 AND deleted_at IS NULL AND status <> 'deleted') AS reshared`,
    [postId, viewerId],
  );
  const row = res.rows[0];
  return {
    liked: Boolean(row?.liked),
    reshared: Boolean(row?.reshared),
  };
}

export async function findAuthorPostEvents(
  postId: string,
  authorId: string,
  client?: PoolClient,
): Promise<AuthorEventSummary[]> {
  const executor = client ?? getPool();
  const res = await executor.query<AuthorEventSummary>(
    `SELECT kind, value, status
     FROM reputation_events
     WHERE post_id = $1 AND user_id = $2
     ORDER BY created_at ASC`,
    [postId, authorId],
  );
  return res.rows;
}

export async function checkCanEditPost(
  postId: string,
  authorId: string,
  editWindowMinutes: number,
  client?: PoolClient,
): Promise<{ allowed: boolean; reason?: string }> {
  const executor = client ?? getPool();

  const res = await executor.query<{
    author_id: string;
    status: string;
    is_expired: boolean;
    has_assessment: boolean;
    has_open_report: boolean;
  }>(
    `SELECT
      p.author_id,
      p.status,
      (p.created_at < now() - ($2 || ' minutes')::interval) AS is_expired,
      EXISTS(SELECT 1 FROM assessments WHERE post_id = p.id) AS has_assessment,
      EXISTS(SELECT 1 FROM reports WHERE post_id = p.id AND status = 'open') AS has_open_report
    FROM posts p
    WHERE p.id = $1`,
    [postId, editWindowMinutes.toString()],
  );

  const row = res.rows[0];
  if (!row || row.status === 'deleted' || row.author_id !== authorId) {
    return { allowed: false, reason: 'Post not found or unauthorized' };
  }
  if (row.is_expired) {
    return { allowed: false, reason: 'Edit window expired' };
  }
  if (row.has_assessment) {
    return { allowed: false, reason: 'Post already has an assessment' };
  }
  if (row.has_open_report) {
    return { allowed: false, reason: 'Post has an open report' };
  }

  return { allowed: true };
}

export async function updatePostContent(
  params: {
    postId: string;
    oldRevision: number;
    oldBody: string;
    oldSourceUrl: string | null;
    newBody?: string;
    newSourceUrl?: string | null;
  },
  client?: PoolClient,
): Promise<PostAuthorJoinedRow> {
  const executor = client ?? getPool();

  // 1. Record old revision in post_revisions
  await executor.query(
    `INSERT INTO post_revisions (post_id, revision, body, source_url)
     VALUES ($1, $2, $3, $4)`,
    [params.postId, params.oldRevision, params.oldBody, params.oldSourceUrl],
  );

  // 2. Update post row
  const res = await executor.query<PostAuthorJoinedRow>(
    `WITH updated AS (
      UPDATE posts
      SET
        body = COALESCE($1, body),
        source_url = CASE WHEN $2::boolean THEN $3 ELSE source_url END,
        revision = revision + 1,
        edited_at = now()
      WHERE id = $4
      RETURNING *
    )
    SELECT
      u_p.*,
      u.username AS author_username,
      u.display_name AS author_display_name,
      u.avatar_media_id AS author_avatar_media_id,
      u.q AS author_q
    FROM updated u_p
    JOIN users u ON u.id = u_p.author_id`,
    [
      params.newBody ?? null,
      params.newSourceUrl !== undefined,
      params.newSourceUrl ?? null,
      params.postId,
    ],
  );

  return res.rows[0]!;
}

export async function softDeletePostRow(
  postId: string,
  client?: PoolClient,
): Promise<void> {
  const executor = client ?? getPool();
  await executor.query(
    `UPDATE posts
     SET status = 'deleted', deleted_at = now()
     WHERE id = $1`,
    [postId],
  );
}

export async function findPostsByUser(
  authorId: string,
  options: {
    includeHeld: boolean;
    cursor?: DecodedCursor | null;
    limit: number;
  },
  client?: PoolClient,
): Promise<PostAuthorJoinedRow[]> {
  const executor = client ?? getPool();
  const whereClauses: string[] = ['p.author_id = $1', "p.status <> 'deleted'", 'p.deleted_at IS NULL'];
  const values: unknown[] = [authorId];
  let idx = 2;

  if (!options.includeHeld) {
    whereClauses.push("p.status <> 'held'");
  }

  if (options.cursor) {
    whereClauses.push(`(p.created_at, p.id) < ($${idx++}, $${idx++})`);
    values.push(options.cursor.createdAt, options.cursor.id);
  }

  values.push(options.limit + 1);
  const sql = `
    SELECT
      p.*,
      u.username AS author_username,
      u.display_name AS author_display_name,
      u.avatar_media_id AS author_avatar_media_id,
      u.q AS author_q
    FROM posts p
    JOIN users u ON u.id = p.author_id
    WHERE ${whereClauses.join(' AND ')}
    ORDER BY p.created_at DESC, p.id DESC
    LIMIT $${idx}
  `;

  const res = await executor.query<PostAuthorJoinedRow>(sql, values);
  return res.rows;
}
