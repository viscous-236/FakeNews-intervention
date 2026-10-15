import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    // Each test file runs in its own forked process for DB isolation
    pool: 'forks',
    // Files run sequentially to avoid concurrent DB access
    fileParallelism: false,
    // Setup env vars before any test module is loaded
    setupFiles: ['./test/setup/env.ts'],
    globalSetup: './test/setup/globalSetup.ts',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*'],
      exclude: ['src/index.ts'],
      thresholds: {
        // Phase 3 adds 100% for scoring; overall 80% added in TASK-112
        lines: 0,
      },
    },
  },
  resolve: {
    alias: {
      '@app/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
});
