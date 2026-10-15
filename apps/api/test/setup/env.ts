/**
 * Test environment bootstrap (TASK-005, TASK-008).
 *
 * This file is listed in vitest.config.ts as `setupFiles`, so it runs inside
 * every test worker process BEFORE any test module is imported.  Setting env
 * vars here means config.ts (which reads process.env at module-load time)
 * always sees valid values, even in tests that don't need real services.
 *
 * Real services (PostgreSQL, MinIO, Mailpit) are spun up via docker-compose
 * before the test run.  The values below must match docker-compose.yml and
 * scripts/init-test-db.sql.
 */

// Database — real PostgreSQL 16 (docker-compose)
process.env['DATABASE_URL'] ??= 'postgresql://postgres:postgres@localhost:5432/app_test';

// Detector — real FastAPI container (docker-compose)
process.env['DETECTOR_URL'] ??= 'http://localhost:8001';
process.env['DETECTOR_API_KEY'] ??= 'test-detector-key';

// S3 — real MinIO (docker-compose)
process.env['S3_ENDPOINT'] ??= 'http://localhost:9000';
process.env['S3_REGION'] ??= 'us-east-1';
process.env['S3_BUCKET'] ??= 'app-media';
process.env['S3_ACCESS_KEY_ID'] ??= 'minioadmin';
process.env['S3_SECRET_ACCESS_KEY'] ??= 'minioadmin';
process.env['S3_PUBLIC_BASE_URL'] ??= 'http://localhost:9000/app-media';
process.env['S3_FORCE_PATH_STYLE'] ??= 'true';

// SMTP — real Mailpit (docker-compose)
process.env['SMTP_HOST'] ??= 'localhost';
process.env['SMTP_PORT'] ??= '1025';
process.env['SMTP_SECURE'] ??= 'false';
process.env['EMAIL_FROM'] ??= 'noreply@example.com';

// Observability (not required in test)
process.env['METRICS_TOKEN'] ??= 'test-metrics-token';
