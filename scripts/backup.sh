#!/usr/bin/env bash
set -euo pipefail

# scripts/backup.sh (REQ-045, TASK-106)
# Creates a compressed PostgreSQL database dump using pg_dump.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Load .env if DATABASE_URL is not set
if [[ -z "${DATABASE_URL:-}" ]] && [[ -f "$ROOT_DIR/.env" ]]; then
  export $(grep -v '^#' "$ROOT_DIR/.env" | grep 'DATABASE_URL=' | xargs)
fi

DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:5433/app}"
BACKUP_DIR="${ROOT_DIR}/backups"
mkdir -p "$BACKUP_DIR"

TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
DEST_FILE="${1:-${BACKUP_DIR}/backup_${TIMESTAMP}.dump}"

echo "==> Creating database backup to ${DEST_FILE}..."

if command -v pg_dump >/dev/null 2>&1; then
  pg_dump --format=custom --no-owner --no-privileges --dbname="${DATABASE_URL}" --file="${DEST_FILE}"
else
  # Fallback to the docker compose container (POSTGRES_USER=postgres, database app)
  docker compose -f "$ROOT_DIR/docker-compose.yml" exec -T postgres \
    pg_dump --format=custom --no-owner --no-privileges -U postgres app > "${DEST_FILE}"
fi

FILE_SIZE="$(du -h "${DEST_FILE}" | cut -f1)"
echo "==> Backup completed successfully: ${DEST_FILE} (${FILE_SIZE})"
