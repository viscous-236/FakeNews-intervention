#!/usr/bin/env tsx
/**
 * scripts/verify-scores.ts (TASK-023)
 *
 * Verifies platform reputation invariants (I1 through I6).
 * Prints issues found and exits with 1 if any issues exist.
 *
 * Usage:
 *   npx tsx scripts/verify-scores.ts
 */

import './load-env.js';
import { verifyScores } from '../apps/api/src/scoring/verify.js';
import { closePool } from '../apps/api/src/db/pool.js';

export async function main(): Promise<void> {
  try {
    const result = await verifyScores();

    if (!result.ok) {
      console.error(`Score verification FAILED with ${result.issues.length} issue(s):`);
      for (const issue of result.issues) {
        console.error(
          `  [${issue.invariant}] User: ${issue.userId}${issue.waveId ? ` Wave: ${issue.waveId}` : ''} - Expected: ${issue.expected}, Actual: ${issue.actual} (${issue.message ?? 'Invariant violation'})`,
        );
      }
      process.exitCode = 1;
    } else {
      console.log('All score invariants (I1-I6) verified successfully.');
      process.exitCode = 0;
    }
  } catch (err) {
    console.error('Fatal error during score verification:', err);
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}

if (process.env.NODE_ENV !== 'test') {
  main();
}
