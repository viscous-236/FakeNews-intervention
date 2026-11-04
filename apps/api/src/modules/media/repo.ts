/**
 * apps/api/src/modules/media/repo.ts (TASK-041)
 *
 * Repository for media table.
 */

import { type PoolClient } from '../../db/pool.js';
import { getPool } from '../../db/pool.js';

export interface MediaRow {
  id: string;
  owner_id: string;
  kind: 'avatar' | 'post_image';
  object_key: string;
  content_type: string;
  bytes: number;
  width: number;
  height: number;
  created_at: Date;
}

export interface InsertMediaParams {
  id?: string;
  ownerId: string;
  kind: 'avatar' | 'post_image';
  objectKey: string;
  contentType: string;
  bytes: number;
  width: number;
  height: number;
}

export async function insertMedia(
  params: InsertMediaParams,
  client?: PoolClient,
): Promise<MediaRow> {
  const executor = client ?? getPool();
  const sql = `
    INSERT INTO media (
      ${params.id ? 'id,' : ''}
      owner_id,
      kind,
      object_key,
      content_type,
      bytes,
      width,
      height
    ) VALUES (
      ${params.id ? '$8,' : ''}
      $1, $2, $3, $4, $5, $6, $7
    )
    RETURNING
      id, owner_id, kind, object_key, content_type, bytes, width, height, created_at
  `;

  const values: unknown[] = [
    params.ownerId,
    params.kind,
    params.objectKey,
    params.contentType,
    params.bytes,
    params.width,
    params.height,
  ];

  if (params.id) {
    values.push(params.id);
  }

  const res = await executor.query<MediaRow>(sql, values);
  const row = res.rows[0];
  if (!row) {
    throw new Error('Failed to insert media');
  }
  return row;
}

export async function findMediaById(id: string, client?: PoolClient): Promise<MediaRow | null> {
  const executor = client ?? getPool();
  const res = await executor.query<MediaRow>(
    `SELECT id, owner_id, kind, object_key, content_type, bytes, width, height, created_at
     FROM media
     WHERE id = $1`,
    [id],
  );
  return res.rows[0] ?? null;
}

export async function findOrphanedMedia(
  olderThanHours = 24,
  client?: PoolClient,
): Promise<MediaRow[]> {
  const executor = client ?? getPool();
  const res = await executor.query<MediaRow>(
    `SELECT m.id, m.owner_id, m.kind, m.object_key, m.content_type, m.bytes, m.width, m.height, m.created_at
     FROM media m
     WHERE m.created_at < now() - ($1 || ' hours')::interval
       AND NOT EXISTS (SELECT 1 FROM users u WHERE u.avatar_media_id = m.id)
       AND NOT EXISTS (SELECT 1 FROM post_media pm WHERE pm.media_id = m.id)
     LIMIT 100`,
    [olderThanHours.toString()],
  );
  return res.rows;
}

export async function deleteMedia(id: string, client?: PoolClient): Promise<void> {
  const executor = client ?? getPool();
  await executor.query(`DELETE FROM media WHERE id = $1`, [id]);
}
