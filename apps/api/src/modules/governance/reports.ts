/** User reports for posts (RUL-020). */

import { withTransaction } from '../../db/tx.js';
import { AppError } from '../../middleware/errors.js';

export interface CreateReportInput {
  reason: 'false_information' | 'misleading' | 'spam' | 'harassment' | 'other';
  details?: string;
}

export async function createReport(
  postId: string,
  reporterId: string,
  input: CreateReportInput,
  reporterRole: 'user' | 'admin' = 'user',
): Promise<{ id: string }> {
  return withTransaction(async (tx) => {
    const postResult = await tx.query<{
      id: string;
      author_id: string;
      status: 'published' | 'held' | 'deleted';
      deleted_at: Date | null;
    }>(
      `SELECT id, author_id, status, deleted_at
       FROM posts
       WHERE id = $1
       FOR SHARE`,
      [postId],
    );
    const post = postResult.rows[0];
    if (!post || post.status === 'deleted' || post.deleted_at) {
      throw new AppError(404, 'NOT_FOUND', 'Post not found');
    }
    if (post.author_id === reporterId) {
      throw new AppError(403, 'CONFLICT_OF_INTEREST', 'You cannot report your own post');
    }
    if (post.status === 'held' && reporterRole !== 'admin') {
      throw new AppError(404, 'NOT_FOUND', 'Post not found');
    }

    const result = await tx.query<{ id: string }>(
      `INSERT INTO reports (post_id, reporter_id, reason, details)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (post_id, reporter_id) DO NOTHING
       RETURNING id`,
      [postId, reporterId, input.reason, input.details ?? ''],
    );
    const report = result.rows[0];
    if (!report) throw new AppError(409, 'ALREADY_EXISTS', 'You already reported this post');
    return report;
  });
}
