/** Acquire the open wave before post/user/event locks (finalizer lock order). */
import { type PoolClient } from '../db/pool.js';
import { AppError } from '../middleware/appError.js';

export async function lockOpenWave(tx: PoolClient): Promise<string> {
  // Under READ COMMITTED a waiter can see the old row cease to match after
  // finalization commits. A fresh statement then sees the newly opened wave.
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await tx.query<{ id: string }>(
      `SELECT id FROM waves WHERE status = 'open' FOR SHARE`,
    );
    if (result.rows[0]) return result.rows[0].id;
  }
  throw new AppError(500, 'INTERNAL', 'No open wave found');
}
