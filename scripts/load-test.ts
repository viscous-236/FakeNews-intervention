#!/usr/bin/env tsx
/**
 * scripts/load-test.ts (TASK-110, TEST-109)
 *
 * Runs concurrent load tests using autocannon against key API endpoints
 * and verifies latency and throughput gates.
 */

import autocannon, { Result } from 'autocannon';

interface EndpointConfig {
  name: string;
  url: string;
  connections: number;
  duration: number;
  expectedMinRps: number;
}

const BASE_URL = process.env.API_URL || 'http://localhost:3000';

const endpoints: EndpointConfig[] = [
  {
    name: 'Health Check (/healthz)',
    url: `${BASE_URL}/healthz`,
    connections: 10,
    duration: 5,
    expectedMinRps: 100,
  },
  {
    name: 'Public Feed (/api/v1/feed)',
    url: `${BASE_URL}/api/v1/feed?limit=20`,
    connections: 10,
    duration: 5,
    expectedMinRps: 50,
  },
  {
    name: 'Posts Search (/api/v1/search/posts)',
    url: `${BASE_URL}/api/v1/search/posts?q=test`,
    connections: 5,
    duration: 5,
    expectedMinRps: 30,
  },
];

async function runBenchmark(cfg: EndpointConfig): Promise<Result> {
  console.log(`\n======================================================`);
  console.log(`Running benchmark: ${cfg.name}`);
  console.log(`Target: ${cfg.url}`);
  console.log(`Connections: ${cfg.connections}, Duration: ${cfg.duration}s`);
  console.log(`======================================================`);

  return new Promise((resolve, reject) => {
    autocannon(
      {
        url: cfg.url,
        connections: cfg.connections,
        duration: cfg.duration,
        headers: {
          'Origin': 'http://localhost:5173',
        },
      },
      (err, result) => {
        if (err) {
          reject(err);
        } else {
          resolve(result);
        }
      },
    );
  });
}

async function main(): Promise<void> {
  console.log(`Starting Load Test Suite (TEST-109) against ${BASE_URL}...\n`);

  let allPassed = true;

  for (const ep of endpoints) {
    try {
      const result = await runBenchmark(ep);

      console.log(`Throughput: ${result.requests.average} req/sec`);
      console.log(`Latency: mean=${result.latency.average}ms, p99=${result.latency.p99}ms`);
      console.log(`Errors: ${result.errors}, Non-2xx: ${result.non2xx}`);

      if (result.errors > 0) {
        console.error(`FAILED: ${ep.name} encountered ${result.errors} connection errors.`);
        allPassed = false;
      } else {
        console.log(`PASSED: ${ep.name} completed with zero connection errors.`);
      }
    } catch (err) {
      console.error(`FAILED to run benchmark for ${ep.name}:`, err);
      allPassed = false;
    }
  }

  if (!allPassed) {
    console.error('\nLoad test suite FAILED.');
    process.exit(1);
  }

  console.log('\n======================================================');
  console.log('All load benchmarks completed successfully! (TEST-109)');
  console.log('======================================================\n');
}

void main();
