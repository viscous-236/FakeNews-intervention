/** SQL repository for direct messages. */

import { type PoolClient } from '../../db/pool.js';
import { getPool } from '../../db/pool.js';
import { type DecodedCursor } from '../../db/cursor.js';

export interface MessageRow {
  id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  created_at: Date;
  read_at: Date | null;
}

export interface ConversationRow extends MessageRow {
  other_id: string;
  other_username: string;
  other_display_name: string;
  other_avatar_media_id: string | null;
  other_q: string;
  unread_count: string;
}

export async function findConversationMessages(
  userId: string,
  otherUserId: string,
  cursor: DecodedCursor | null,
  limit: number,
  client?: PoolClient,
): Promise<MessageRow[]> {
  const executor = client ?? getPool();
  const result = await executor.query<MessageRow>(
    `SELECT id, sender_id, recipient_id, body, created_at, read_at
       FROM messages
      WHERE ((sender_id = $1 AND recipient_id = $2)
          OR (sender_id = $2 AND recipient_id = $1))
        AND ($3::timestamptz IS NULL OR (created_at, id) < ($3, $4::uuid))
      ORDER BY created_at DESC, id DESC
      LIMIT $5`,
    [userId, otherUserId, cursor?.createdAt ?? null, cursor?.id ?? null, limit + 1],
  );
  return result.rows;
}

export async function findConversations(
  userId: string,
  cursor: DecodedCursor | null,
  limit: number,
  client?: PoolClient,
): Promise<ConversationRow[]> {
  const executor = client ?? getPool();
  const result = await executor.query<ConversationRow>(
    `WITH latest AS (
       SELECT DISTINCT ON (LEAST(sender_id, recipient_id), GREATEST(sender_id, recipient_id))
              m.*,
              CASE WHEN m.sender_id = $1 THEN m.recipient_id ELSE m.sender_id END AS other_id
         FROM messages m
        WHERE m.sender_id = $1 OR m.recipient_id = $1
        ORDER BY LEAST(m.sender_id, m.recipient_id),
                 GREATEST(m.sender_id, m.recipient_id),
                 m.created_at DESC, m.id DESC
     )
     SELECT l.id, l.sender_id, l.recipient_id, l.body, l.created_at, l.read_at,
            l.other_id, u.username AS other_username,
            u.display_name AS other_display_name,
            u.avatar_media_id AS other_avatar_media_id,
            u.q AS other_q,
            (
              SELECT count(*)
                FROM messages unread
               WHERE unread.sender_id = l.other_id
                 AND unread.recipient_id = $1
                 AND unread.read_at IS NULL
            ) AS unread_count
       FROM latest l
       JOIN users u ON u.id = l.other_id
      WHERE u.status <> 'deleted' AND u.deleted_at IS NULL
        AND ($2::timestamptz IS NULL OR (l.created_at, l.id) < ($2, $3::uuid))
      ORDER BY l.created_at DESC, l.id DESC
      LIMIT $4`,
    [userId, cursor?.createdAt ?? null, cursor?.id ?? null, limit + 1],
  );
  return result.rows;
}

export async function insertMessage(
  senderId: string,
  recipientId: string,
  body: string,
  client?: PoolClient,
): Promise<MessageRow> {
  const executor = client ?? getPool();
  const result = await executor.query<MessageRow>(
    `INSERT INTO messages (sender_id, recipient_id, body)
     VALUES ($1, $2, $3)
     RETURNING id, sender_id, recipient_id, body, created_at, read_at`,
    [senderId, recipientId, body],
  );
  return result.rows[0]!;
}

export async function markConversationRead(
  userId: string,
  otherUserId: string,
  client?: PoolClient,
): Promise<string[]> {
  const executor = client ?? getPool();
  const result = await executor.query<{ id: string }>(
    `UPDATE messages
        SET read_at = now()
      WHERE sender_id = $1 AND recipient_id = $2 AND read_at IS NULL
      RETURNING id`,
    [otherUserId, userId],
  );
  return result.rows.map((row) => row.id);
}
