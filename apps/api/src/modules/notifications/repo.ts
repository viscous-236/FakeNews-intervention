/**
 * apps/api/src/modules/notifications/repo.ts (TASK-042, RUL-025, REQ-044)
 *
 * SQL repository for notifications.
 */

import { type PoolClient } from '../../db/pool.js';
import { getPool } from '../../db/pool.js';
import { type DecodedCursor } from '../../db/cursor.js';

export type NotificationType =
  | 'post_flagged'
  | 'assessment_decided'
  | 'appeal_opened'
  | 'appeal_resolved'
  | 'report_resolved'
  | 'wave_finalized'
  | 'new_follower'
  | 'like'
  | 'comment'
  | 'reshare'
  | 'message';

export interface NotificationJoinedRow {
  id: string;
  user_id: string;
  type: NotificationType;
  actor_id: string | null;
  post_id: string | null;
  payload: Record<string, unknown>;
  created_at: Date;
  read_at: Date | null;
  actor_username: string | null;
  actor_display_name: string | null;
  actor_avatar_media_id: string | null;
  actor_q: string | null;
}

export interface InsertNotificationParams {
  id?: string;
  userId: string;
  type: NotificationType;
  actorId?: string | null;
  postId?: string | null;
  payload?: Record<string, unknown>;
}

export async function insertNotification(
  params: InsertNotificationParams,
  client?: PoolClient,
): Promise<NotificationJoinedRow> {
  const executor = client ?? getPool();
  const res = await executor.query<NotificationJoinedRow>(
    `WITH inserted AS (
      INSERT INTO notifications (
        ${params.id ? 'id,' : ''}
        user_id,
        type,
        actor_id,
        post_id,
        payload
      ) VALUES (
        ${params.id ? '$6,' : ''}
        $1, $2, $3, $4, $5
      )
      RETURNING *
    )
    SELECT
      i.id, i.user_id, i.type, i.actor_id, i.post_id, i.payload, i.created_at, i.read_at,
      u.username AS actor_username,
      u.display_name AS actor_display_name,
      u.avatar_media_id AS actor_avatar_media_id,
      u.q AS actor_q
    FROM inserted i
    LEFT JOIN users u ON u.id = i.actor_id`,
    params.id
      ? [
          params.userId,
          params.type,
          params.actorId ?? null,
          params.postId ?? null,
          JSON.stringify(params.payload ?? {}),
          params.id,
        ]
      : [
          params.userId,
          params.type,
          params.actorId ?? null,
          params.postId ?? null,
          JSON.stringify(params.payload ?? {}),
        ],
  );

  const row = res.rows[0];
  if (!row) {
    throw new Error('Failed to insert notification');
  }
  return row;
}

export async function findNotifications(
  userId: string,
  options: {
    unreadOnly?: boolean;
    cursor?: DecodedCursor | null;
    limit: number;
  },
  client?: PoolClient,
): Promise<NotificationJoinedRow[]> {
  const executor = client ?? getPool();
  const whereClauses: string[] = ['n.user_id = $1'];
  const values: unknown[] = [userId];
  let idx = 2;

  if (options.unreadOnly) {
    whereClauses.push('n.read_at IS NULL');
  }

  if (options.cursor) {
    whereClauses.push(`(n.created_at, n.id) < ($${idx++}, $${idx++})`);
    values.push(options.cursor.createdAt, options.cursor.id);
  }

  values.push(options.limit + 1);
  const sql = `
    SELECT
      n.id, n.user_id, n.type, n.actor_id, n.post_id, n.payload, n.created_at, n.read_at,
      u.username AS actor_username,
      u.display_name AS actor_display_name,
      u.avatar_media_id AS actor_avatar_media_id,
      u.q AS actor_q
    FROM notifications n
    LEFT JOIN users u ON u.id = n.actor_id
    WHERE ${whereClauses.join(' AND ')}
    ORDER BY n.created_at DESC, n.id DESC
    LIMIT $${idx}
  `;

  const res = await executor.query<NotificationJoinedRow>(sql, values);
  return res.rows;
}

export async function countUnreadNotifications(
  userId: string,
  client?: PoolClient,
): Promise<number> {
  const executor = client ?? getPool();
  const res = await executor.query<{ count: string }>(
    `SELECT count(*) FROM notifications
     WHERE user_id = $1 AND read_at IS NULL`,
    [userId],
  );
  return parseInt(res.rows[0]?.count ?? '0', 10);
}

export async function markNotificationsAsRead(
  userId: string,
  ids?: string[],
  client?: PoolClient,
): Promise<void> {
  const executor = client ?? getPool();
  if (ids && ids.length > 0) {
    await executor.query(
      `UPDATE notifications
       SET read_at = now()
       WHERE user_id = $1 AND id = ANY($2) AND read_at IS NULL`,
      [userId, ids],
    );
  } else {
    await executor.query(
      `UPDATE notifications
       SET read_at = now()
       WHERE user_id = $1 AND read_at IS NULL`,
      [userId],
    );
  }
}

export async function findNotificationById(
  id: string,
  client?: PoolClient,
): Promise<NotificationJoinedRow | null> {
  const executor = client ?? getPool();
  const res = await executor.query<NotificationJoinedRow>(
    `SELECT
      n.id, n.user_id, n.type, n.actor_id, n.post_id, n.payload, n.created_at, n.read_at,
      u.username AS actor_username,
      u.display_name AS actor_display_name,
      u.avatar_media_id AS actor_avatar_media_id,
      u.q AS actor_q
    FROM notifications n
    LEFT JOIN users u ON u.id = n.actor_id
    WHERE n.id = $1`,
    [id],
  );
  return res.rows[0] ?? null;
}
