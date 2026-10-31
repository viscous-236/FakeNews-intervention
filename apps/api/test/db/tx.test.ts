/**
 * apps/api/test/db/tx.test.ts  (TASK-010)
 *
 * Tests for withTransaction (PAT-002):
 *   1. Commits on success — INSERT visible after the call.
 *   2. Rolls back on throw — INSERT NOT visible after the call.
 *   3. Client released after commit — pool stays usable.
 *   4. Client released after rollback — pool stays usable.
 *
 * REQUIRES: PostgreSQL 16 running on port 5433 (docker compose up -d).
 * Skips cleanly when DB unavailable.
 *
 * Uses a real permanent table (created + dropped per test run).
 * withTransaction and verifyPool both connect to app_test.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { withTransaction } from '../../src/db/tx.js';
import { getTestPool, closeTestPool } from '../setup/db.js';

let dbAvailable = true;

beforeAll(async () => {
  try {
    const pool = getTestPool();
    await pool.query('SELECT 1');
    // Create a permanent scratch table for this test file
    // Using IF NOT EXISTS so parallel workers (none here) are safe
    await pool.query(`
      CREATE TABLE IF NOT EXISTS _tx_scratch (
        id  serial PRIMARY KEY,
        val text NOT NULL,
        pid int NOT NULL DEFAULT pg_backend_pid()
      )
    `);
  } catch {
    dbAvailable = false;
  }
});

afterAll(async () => {
  if (dbAvailable) {
    const pool = getTestPool();
    await pool.query('DROP TABLE IF EXISTS _tx_scratch').catch(() => null);
  }
  await closeTestPool();
});

describe('withTransaction (TASK-010)', () => {
  it('commits on success — row is visible outside the transaction', async () => {
    if (!dbAvailable) {
      console.warn('  SKIPPED — PostgreSQL not available (port 5433)');
      return;
    }

    const tag = `commit-${Date.now()}`;
    await withTransaction(async (tx) => {
      await tx.query(`INSERT INTO _tx_scratch (val) VALUES ($1)`, [tag]);
    });

    const pool = getTestPool();
    const res = await pool.query<{ val: string }>(
      `SELECT val FROM _tx_scratch WHERE val = $1`,
      [tag],
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]!.val).toBe(tag);
  });

  it('rolls back on throw — row is NOT visible outside the transaction', async () => {
    if (!dbAvailable) {
      console.warn('  SKIPPED — PostgreSQL not available (port 5433)');
      return;
    }

    const tag = `rollback-${Date.now()}`;
    await expect(
      withTransaction(async (tx) => {
        await tx.query(`INSERT INTO _tx_scratch (val) VALUES ($1)`, [tag]);
        throw new Error('deliberate rollback');
      }),
    ).rejects.toThrow('deliberate rollback');

    const pool = getTestPool();
    const res = await pool.query<{ val: string }>(
      `SELECT val FROM _tx_scratch WHERE val = $1`,
      [tag],
    );
    expect(res.rows).toHaveLength(0);
  });

  it('releases client after commit — pool still usable for 3 sequential calls', async () => {
    if (!dbAvailable) {
      console.warn('  SKIPPED — PostgreSQL not available (port 5433)');
      return;
    }

    for (let i = 0; i < 3; i++) {
      await withTransaction(async (tx) => {
        await tx.query('SELECT 1');
      });
    }
    // Reaching here means the pool was not exhausted
    expect(true).toBe(true);
  });

  it('releases client after rollback — pool still usable', async () => {
    if (!dbAvailable) {
      console.warn('  SKIPPED — PostgreSQL not available (port 5433)');
      return;
    }

    for (let i = 0; i < 3; i++) {
      await expect(
        withTransaction(async () => {
          throw new Error('rollback');
        }),
      ).rejects.toThrow('rollback');
    }

    // Pool must still be able to serve a transaction
    await withTransaction(async (tx) => {
      await tx.query('SELECT 1');
    });
    expect(true).toBe(true);
  });
});
