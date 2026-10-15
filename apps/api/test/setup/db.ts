/**
 * Per-test database helpers (TASK-008).
 *
 * truncateAll() — called at the start of each DB-dependent test file.
 * Truncates every table with CASCADE, then seeds wave number 1 as open.
 * This keeps tests independent of each other.
 *
 * Requires PostgreSQL 16 + migrations to have run (see globalSetup.ts).
 */

import { Pool } from 'pg';

// ---------------------------------------------------------------------------
// Shared test pool (created lazily; closed at process exit)
// ---------------------------------------------------------------------------
let _pool: Pool | null = null;

export function getTestPool(): Pool {
  if (!_pool) {
    _pool = new Pool({
      connectionString:
        process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@localhost:5432/app_test',
      max: 5,
      statement_timeout: 10_000,
    });
  }
  return _pool;
}

export async function closeTestPool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}

// ---------------------------------------------------------------------------
// Table names in dependency order for TRUNCATE ... CASCADE
// ---------------------------------------------------------------------------
const TRUNCATE_ORDER = [
  'admin_audit_log',
  'appeals',
  'reputation_events',
  'user_wave_reputation',
  'assessments',
  'reports',
  'notifications',
  'messages',
  'post_media',
  'post_revisions',
  'detection_results',
  'likes',
  'comments',
  'follows',
  'blocks',
  'posts',
  'waves',
  'email_outbox',
  'email_tokens',
  'sessions',
  'media',
  'users',
];

/**
 * Reset the test database to a known empty state and seed wave 1 as open.
 * Call this at the start of each test file (not each test) to avoid
 * per-test overhead while still maintaining isolation between files.
 */
export async function truncateAll(): Promise<void> {
  const pool = getTestPool();
  const tables = TRUNCATE_ORDER.join(', ');
  await pool.query(`TRUNCATE TABLE ${tables} CASCADE`);
  // Re-seed the mandatory open wave (migration creates it; truncate removes it)
  await pool.query(`INSERT INTO waves (number, status) VALUES (1, 'open')`);
}
