/**
 * Vitest global setup (TASK-008).
 *
 * Runs ONCE before all test files, in a separate process.
 * Responsibilities:
 *   1. Run all migrations against app_test (ensures schema is up to date).
 *
 * This file must NOT import config.ts (it runs before setupFiles).
 * Connection details are read directly from env vars with fallbacks matching
 * the docker-compose defaults.
 *
 * NOTE: Requires PostgreSQL 16 running via docker-compose.
 * Without Docker the migration step will fail — see DEC-001 in DECISIONS.md.
 */

import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

export async function setup(): Promise<void> {
  const databaseUrl =
    process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@localhost:5432/app_test';

  const apiRoot = path.resolve(__dirname, '../../');
  const migrationsDir = path.join(apiRoot, 'src/db/migrations');

  if (!fs.existsSync(migrationsDir)) {
    console.log('[globalSetup] Migrations directory does not exist yet (Phase 2). Skipping.');
    return;
  }

  console.log('[globalSetup] Running migrations on test database…');

  try {
    execSync(`npx node-pg-migrate up --migrations-dir "${migrationsDir}"`, {
      cwd: apiRoot,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'inherit',
    });
    console.log('[globalSetup] Migrations complete.');
  } catch (err) {
    // Migrations will fail if PostgreSQL is not running.
    // Tests that don't need the DB (health, config) will still pass.
    console.warn(
      '[globalSetup] Migration failed — database tests will fail.\n' +
        '  Start docker-compose services: docker compose up -d\n' +
        `  Error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
