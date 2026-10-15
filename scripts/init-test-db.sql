-- scripts/init-test-db.sql
-- Creates the app_test database alongside the default app database.
-- Run automatically by the postgres docker-entrypoint on first start.

SELECT 'CREATE DATABASE app_test'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'app_test')
\gexec
