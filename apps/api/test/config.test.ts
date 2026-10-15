/**
 * TASK-005 tests: configuration validation.
 *
 * Tests that parseConfig() throws a readable error with field names
 * when required environment variables are missing or invalid.
 */

import { describe, it, expect } from 'vitest';
import { parseConfig } from '../src/config';

/** Minimal valid env that satisfies all required fields */
function validEnv(): NodeJS.ProcessEnv {
  return {
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/app_test',
    DETECTOR_URL: 'http://localhost:8001',
    DETECTOR_API_KEY: 'test-key',
    S3_ENDPOINT: 'http://localhost:9000',
    S3_REGION: 'us-east-1',
    S3_BUCKET: 'app-media',
    S3_ACCESS_KEY_ID: 'minioadmin',
    S3_SECRET_ACCESS_KEY: 'minioadmin',
    S3_PUBLIC_BASE_URL: 'http://localhost:9000/app-media',
    SMTP_HOST: 'localhost',
    SMTP_PORT: '1025',
    EMAIL_FROM: 'noreply@example.com',
  };
}

describe('parseConfig()', () => {
  it('returns a valid config object when all required vars are present', () => {
    const cfg = parseConfig(validEnv());
    expect(cfg.DATABASE_URL).toBe('postgresql://postgres:postgres@localhost:5432/app_test');
    expect(cfg.PORT).toBe(3000);
    expect(cfg.SIGMA_DEFAULT).toBe(0.5);
  });

  it('exits with readable error when DATABASE_URL is missing', () => {
    const env = validEnv();
    delete env['DATABASE_URL'];
    expect(() => parseConfig(env)).toThrow(/DATABASE_URL/);
    expect(() => parseConfig(env)).toThrow(/Configuration error/);
  });

  it('exits with readable error when DETECTOR_URL is missing', () => {
    const env = validEnv();
    delete env['DETECTOR_URL'];
    expect(() => parseConfig(env)).toThrow(/DETECTOR_URL/);
  });

  it('exits with readable error when SMTP_PORT is not a number', () => {
    const env = { ...validEnv(), SMTP_PORT: 'not-a-port' };
    expect(() => parseConfig(env)).toThrow();
  });

  it('defaults DATABASE_URL_DIRECT to DATABASE_URL when not set', () => {
    const cfg = parseConfig(validEnv());
    expect(cfg.DATABASE_URL_DIRECT).toBe(cfg.DATABASE_URL);
  });

  it('sets COOKIE_SECURE=true when NODE_ENV=production', () => {
    const cfg = parseConfig({ ...validEnv(), NODE_ENV: 'production' });
    expect(cfg.COOKIE_SECURE).toBe(true);
  });

  it('sets COOKIE_SECURE=false when NODE_ENV=development', () => {
    const cfg = parseConfig({ ...validEnv(), NODE_ENV: 'development' });
    expect(cfg.COOKIE_SECURE).toBe(false);
  });

  it('parses DETECTOR_BACKOFF_SECONDS csv into an array of numbers', () => {
    const cfg = parseConfig({ ...validEnv(), DETECTOR_BACKOFF_SECONDS: '10,60,300' });
    expect(cfg.DETECTOR_BACKOFF_SECONDS).toStrictEqual([10, 60, 300]);
  });
});
