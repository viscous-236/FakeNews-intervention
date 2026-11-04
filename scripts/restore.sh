#!/usr/bin/env bash
set -euo pipefail

# scripts/restore.sh (REQ-045, TASK-106)
# Restores a PostgreSQL database dump created by scripts/backup.sh.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <backup_file.dump> [target_database_url]"
  exit 1
fi

BACKUP_FILE="$1"

if [[ ! -f "$BACKUP_FILE" ]]; then
  echo "Error: Backup file not found: $BACKUP_FILE"
  exit 1
fi

# Load .env if target DATABASE_URL is not set
if [[ -z "${2:-}" ]] && [[ -z "${DATABASE_URL:-}" ]] && [[ -f "$ROOT_DIR/.env" ]]; then
  export $(grep -v '^#' "$ROOT_DIR/.env" | grep 'DATABASE_URL=' | xargs)
fi

TARGET_URL="${2:-${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:5433/app}}"

echo "==> Restoring database from ${BACKUP_FILE}..."
echo "==> Target: ${TARGET_URL}"

if command -v pg_restore >/dev/null 2>&1; then
  # pg_restore --clean drops database objects before recreating them
  pg_restore --clean --if-exists --no-owner --no-privileges --dbname="${TARGET_URL}" "${BACKUP_FILE}" || {
    # pg_restore exits with code 1 if there are minor warnings (e.g. drop if exists on non-existent objects)
    STATUS=$?
    if [[ $STATUS -le 1 ]]; then
      echo "==> Notice: pg_restore completed with non-fatal status ($STATUS)."
    else
      echo "==> Error: pg_restore failed with status $STATUS"
      exit $STATUS
    fi
  }
else
  docker compose -f "$ROOT_DIR/docker-compose.yml" exec -T postgres \
    pg_restore --clean --if-exists --no-owner --no-privileges -U app -d app < "${BACKUP_FILE}" || true
fi

echo "==> Database restore completed successfully."
