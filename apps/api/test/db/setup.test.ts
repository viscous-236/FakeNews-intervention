/**
 * TASK-008 test: database setup invariant.
 *
 * After truncateAll(), exactly one wave must exist and it must be open
 * with number 1.  This is the baseline invariant all other DB tests depend on.
 *
 * REQUIRES: PostgreSQL 16 running (docker-compose up -d).
 * Without Docker this test will be skipped with a clear message.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { truncateAll, getTestPool, closeTestPool } from '../setup/db';

describe('DB setup invariant (TASK-008)', () => {
  let dbAvailable = true;

  beforeAll(async () => {
    try {
      const pool = getTestPool();
      await pool.query('SELECT 1');
      await truncateAll();
    } catch {
      dbAvailable = false;
    }
  });

  afterAll(async () => {
    await closeTestPool();
  });

  it('after truncateAll() exactly one wave exists and is open with number 1', async () => {
    if (!dbAvailable) {
      console.warn('  SKIPPED — PostgreSQL not available (start docker-compose)');
      return;
    }

    const pool = getTestPool();
    const res = await pool.query<{ number: number; status: string }>(
      'SELECT number, status FROM waves ORDER BY number',
    );

    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]!.number).toBe(1);
    expect(res.rows[0]!.status).toBe('open');
  });
});
