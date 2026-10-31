/**
 * apps/api/src/db/pool.ts  (TASK-010)
 *
 * Singleton pg.Pool for the application.
 * - Reads DATABASE_URL and DATABASE_POOL_MAX from validated config.
 * - Sets statement_timeout = 10 s per connection (REQ-038).
 * - Sets application_name so pg_stat_activity shows the app name.
 */

import { Pool, type PoolClient } from 'pg';
import { config } from '../config.js';

let _pool: Pool | null = null;

/** Return the singleton Pool, creating it on first call. */
export function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool({
      connectionString: config.DATABASE_URL,
      max: config.DATABASE_POOL_MAX,
      // application_name visible in pg_stat_activity
      application_name: 'mini-btp-api',
      // statement_timeout enforced at connection level (REQ-038)
      statement_timeout: 10_000,
    });

    _pool.on('error', (err) => {
      // Non-fatal: the pool will keep trying; log and continue
      // (logger not imported here to avoid circular deps; use console)
      console.error({ err }, 'pg pool idle client error');
    });
  }
  return _pool;
}

/** Close the pool. Call once during graceful shutdown (REQ-037). */
export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}

/** Expose a PoolClient type alias for convenience. */
export type { PoolClient };
