/**
 * apps/api/src/db/tx.ts  (TASK-010)
 *
 * withTransaction<T>(fn) – PAT-002
 *
 * Checks out a client from the pool, BEGIN, calls fn(client), then:
 *   - COMMIT + release on success (returns fn's result)
 *   - ROLLBACK + release on throw (rethrows)
 *
 * Usage:
 *   const result = await withTransaction(async (tx) => {
 *     const row = await tx.query('INSERT INTO ... RETURNING id');
 *     return row.rows[0];
 *   });
 */

import { getPool, type PoolClient } from './pool.js';

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
