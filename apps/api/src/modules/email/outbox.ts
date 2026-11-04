/**
 * apps/api/src/modules/email/outbox.ts (TASK-039, REQ-039, REQ-040)
 *
 * Transactional email outbox background dispatcher with retry backoff:
 * 1 min, 5 min, 30 min, then failed_permanent.
 */

import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { withTransaction } from '../../db/tx.js';
import { config } from '../../config.js';
import { logger } from '../../logger.js';

export const EMAIL_OUTBOX_LOCK_ID = 42002;

let transporter: Transporter | null = null;

export function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      // Section 1.1: API → SMTP times out after 15 s; the outbox retries.
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 15_000,
      auth: config.SMTP_USER
        ? {
            user: config.SMTP_USER,
            pass: config.SMTP_PASS,
          }
        : undefined,
    });
  }
  return transporter;
}

export interface OutboxEmailRow {
  id: string;
  to_email: string;
  subject: string;
  body_text: string;
  attempts: number;
}

/**
 * Dispatch due emails from email_outbox under an advisory lock.
 */
export async function sendQueuedEmails(): Promise<number> {
  return withTransaction(async (tx) => {
    // Acquire non-blocking transaction-scoped advisory lock (REQ-039)
    const lockRes = await tx.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_xact_lock($1) AS locked`,
      [EMAIL_OUTBOX_LOCK_ID],
    );

    if (!lockRes.rows[0]?.locked) {
      return 0;
    }

    const res = await tx.query<OutboxEmailRow>(
      `SELECT id, to_email, subject, body_text, attempts
       FROM email_outbox
       WHERE status = 'queued' AND next_attempt_at <= now()
       ORDER BY next_attempt_at ASC, created_at ASC
       LIMIT 50
       FOR UPDATE SKIP LOCKED`,
    );

    const rows = res.rows;
    if (rows.length === 0) {
      return 0;
    }

    const mailer = getTransporter();
    let sentCount = 0;

    for (const row of rows) {
      try {
        await mailer.sendMail({
          from: config.EMAIL_FROM,
          to: row.to_email,
          subject: row.subject,
          text: row.body_text,
        });

        await tx.query(
          `UPDATE email_outbox
           SET status = 'sent', sent_at = now()
           WHERE id = $1`,
          [row.id],
        );
        sentCount += 1;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'SMTP delivery failed';
        const newAttempts = row.attempts + 1;

        logger.warn(
          { emailId: row.id, error: errorMsg, attempts: newAttempts },
          'Email delivery failed, applying retry schedule',
        );

        await tx.query(
          `UPDATE email_outbox
           SET attempts = $1,
               last_error = $2,
               status = CASE WHEN $1 >= 4 THEN 'failed_permanent' ELSE 'queued' END,
               next_attempt_at = CASE
                 WHEN $1 = 1 THEN now() + interval '1 minute'
                 WHEN $1 = 2 THEN now() + interval '5 minutes'
                 WHEN $1 = 3 THEN now() + interval '30 minutes'
                 ELSE now()
               END
           WHERE id = $3`,
          [newAttempts, errorMsg, row.id],
        );
      }
    }

    return sentCount;
  });
}

let _outboxInterval: NodeJS.Timeout | null = null;

/**
 * Start periodic 10-second email outbox dispatcher loop (REQ-040).
 */
export function startEmailOutbox(intervalMs = 10_000): void {
  if (_outboxInterval) {
    return;
  }

  _outboxInterval = setInterval(async () => {
    try {
      await sendQueuedEmails();
    } catch (err) {
      logger.error({ err }, 'Error in email outbox dispatcher loop');
    }
  }, intervalMs);

  _outboxInterval.unref();
}

/**
 * Stop email outbox dispatcher loop.
 */
export function stopEmailOutbox(): void {
  if (_outboxInterval) {
    clearInterval(_outboxInterval);
    _outboxInterval = null;
  }
}
