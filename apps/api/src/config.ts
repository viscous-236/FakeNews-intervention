/**
 * Configuration — validated with Zod at startup (REQ-036).
 * All environment variables are read through this module.
 * Direct access to process.env elsewhere is forbidden.
 *
 * GUD-008: No if(NODE_ENV) branches in domain logic.
 * COOKIE_SECURE defaults to true in production (config layer exception).
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const boolEnvSchema = z
  .string()
  .transform((v) => v === 'true' || v === '1')
  .or(z.boolean());

const csvIntsSchema = z
  .string()
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map(Number),
  )
  .pipe(z.number().int().positive().array().min(1));

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_ORIGIN: z.string().url().default('http://localhost:5173'),
  TRUST_PROXY: z.coerce.number().int().min(0).default(1),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // Database
  DATABASE_URL: z.string().min(1),
  DATABASE_URL_DIRECT: z.string().min(1).optional(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).default(10),

  // Session
  SESSION_COOKIE_NAME: z.string().default('sid'),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).default(30),
  COOKIE_SECURE: boolEnvSchema.optional(),

  // Detector
  DETECTOR_URL: z.string().url(),
  DETECTOR_API_KEY: z.string().min(1),
  DETECTOR_TIMEOUT_MS: z.coerce.number().int().min(1).default(15_000),
  DETECTOR_WARMUP_TIMEOUT_MS: z.coerce.number().int().min(1).default(90_000),
  DETECTOR_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(3),
  DETECTOR_BACKOFF_SECONDS: csvIntsSchema.default('30,120,600'),
  DETECTOR_POLL_INTERVAL_MS: z.coerce.number().int().min(100).default(2_000),

  // Thresholds (updated after TASK-036)
  FAKE_THRESHOLD_HIGH: z.coerce.number().min(0).max(1).default(0.65),
  REAL_THRESHOLD_LOW: z.coerce.number().min(0).max(1).default(0.35),

  // Scoring
  SIGMA_DEFAULT: z.coerce.number().min(0).max(1).default(0.5),
  FORMULA_VERSION: z.string().default('paper-eq2-v1'),
  WAVE_AUTO_FINALIZE_INTERVAL_HOURS: z.coerce.number().int().min(0).default(0),
  AUTO_REAL_ENABLED: boolEnvSchema.default('true'),
  AUTO_REAL_DELAY_MINUTES: z.coerce.number().int().min(1).default(60),
  RESHARE_PENALTY_ENABLED: boolEnvSchema.default('true'),
  MAX_RESPONSIBLE_POST_EVENTS_PER_WAVE: z.coerce.number().int().min(1).default(5),
  MAX_VALID_REPORT_EVENTS_PER_WAVE: z.coerce.number().int().min(1).default(5),
  APPEAL_WINDOW_DAYS: z.coerce.number().int().min(1).default(14),
  EDIT_WINDOW_MINUTES: z.coerce.number().int().min(1).default(15),
  Q_TRUSTED_MIN: z.coerce.number().default(3.0),
  Q_LOW_MAX: z.coerce.number().default(-1.5),
  HOLD_LOW_TIER_POSTS: boolEnvSchema.default('false'),
  PUBLIC_SCORE_VISIBILITY: z.enum(['tier_only', 'full']).default('tier_only'),
  REQUIRE_EMAIL_VERIFICATION: boolEnvSchema.default('true'),

  // S3-compatible object storage
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_PUBLIC_BASE_URL: z.string().url(),
  S3_FORCE_PATH_STYLE: boolEnvSchema.default('false'),

  // SMTP
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SECURE: boolEnvSchema.default('false'),
  EMAIL_FROM: z.string().email(),

  // Observability
  SENTRY_DSN: z.string().url().optional(),
  METRICS_TOKEN: z.string().min(1).optional(),
});

// ---------------------------------------------------------------------------
// Parser — exported so tests can call it with arbitrary env maps
// ---------------------------------------------------------------------------

export type Config = z.infer<typeof ConfigSchema> & {
  DATABASE_URL_DIRECT: string;
  COOKIE_SECURE: boolean;
};

export function parseConfig(env: NodeJS.ProcessEnv): Config {
  const result = ConfigSchema.safeParse(env);
  if (!result.success) {
    const messages = result.error.issues
      .map((i) => `  ${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('\n');
    throw new Error(`Configuration error — check your environment:\n${messages}`);
  }
  const data = result.data;
  return {
    ...data,
    DATABASE_URL_DIRECT: data.DATABASE_URL_DIRECT ?? data.DATABASE_URL,
    COOKIE_SECURE: data.COOKIE_SECURE ?? data.NODE_ENV === 'production',
  };
}

// ---------------------------------------------------------------------------
// Singleton — loaded once at startup; fails fast on bad env (REQ-036)
// ---------------------------------------------------------------------------
export const config: Config = parseConfig(process.env as NodeJS.ProcessEnv);
