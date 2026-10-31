#!/usr/bin/env tsx
/**
 * scripts/create-admin.ts (TASK-016)
 *
 * CLI script to create an admin user.
 * Usage:
 *   npx tsx scripts/create-admin.ts --username admin --email admin@example.com --password adminSecret123 --display-name "System Admin" [--sigma 0.500]
 */

import './load-env.js';
import { parseArgs } from 'util';
import { createUser } from '../apps/api/src/modules/users/service.js';
import { closePool } from '../apps/api/src/db/pool.js';

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      username: { type: 'string' },
      email: { type: 'string' },
      password: { type: 'string' },
      'display-name': { type: 'string' },
      sigma: { type: 'string' },
    },
    strict: false,
  });

  if (!values.username || !values.email || !values.password || !values['display-name']) {
    console.error('Usage: create-admin.ts --username <name> --email <email> --password <pwd> --display-name <name> [--sigma <0..1>]');
    process.exitCode = 1;
    return;
  }

  const sigma = values.sigma !== undefined ? parseFloat(values.sigma) : undefined;
  if (sigma !== undefined && (Number.isNaN(sigma) || sigma < 0 || sigma > 1)) {
    console.error('Error: sigma must be a number between 0 and 1');
    process.exitCode = 1;
    return;
  }

  try {
    const user = await createUser({
      username: values.username,
      email: values.email,
      password: values.password,
      displayName: values['display-name'],
      role: 'admin',
      sigma,
      emailVerified: true,
    });
    console.log(`Created admin ${user.username} (${user.id}) with sigma=${user.sigma}`);
  } catch (err) {
    console.error('Failed to create admin:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}

// Run directly if invoked from CLI
if (process.argv[1]?.endsWith('create-admin.ts')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
