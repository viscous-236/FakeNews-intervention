/**
 * apps/api/src/modules/email/service.ts (TASK-039)
 *
 * Transactional email service inserting into email_outbox table.
 */

import { type PoolClient } from '../../db/pool.js';
import { getPool } from '../../db/pool.js';

export interface EnqueueEmailInput {
  toEmail: string;
  subject: string;
  bodyText: string;
}

export async function enqueueEmail(
  toEmail: string,
  subject: string,
  bodyText: string,
  client?: PoolClient,
): Promise<string> {
  const executor = client ?? getPool();
  const res = await executor.query<{ id: string }>(
    `INSERT INTO email_outbox (to_email, subject, body_text)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [toEmail, subject, bodyText],
  );
  return res.rows[0]!.id;
}
