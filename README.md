# FakeNews Intervention Platform

A production-grade Twitter-like platform implementing the wave-based reputation scoring formula from the paper _"Towards A Platform-Level Reward-Penalty Framework for Misinformation Intervention on Social Media"_.

**Formula:** `Q_i(w+1) = Q_i(w) + σ_i · R_i(w)`

## Architecture

```
Browser (React SPA) ──HTTPS──▶ API (Node.js + Express 5)
                                  ├── PostgreSQL 16     (source of truth)
                                  ├── Detector (FastAPI) (POST /v1/predict)
                                  ├── Object Storage    (S3-compatible)
                                  └── SMTP              (email)
```

## Prerequisites

- Node.js 22+ (`nvm use` or see `.nvmrc`)
- Docker and docker-compose (for PostgreSQL, MinIO, Mailpit, Detector)
- Python 3.12 (for the detector service)

## Local Setup

```bash
# 1. Start infrastructure
docker compose up -d

# 2. Install dependencies
npm ci

# 3. Build shared package
npm run build -w packages/shared

# 4. Copy and configure environment
cp .env.example .env
# Edit .env if needed (docker-compose defaults work out of the box)

# 5. Run database migrations (app and test databases)
npm run db:migrate
npm run db:migrate:test

# 6. Create admin user
npx tsx apps/api/scripts/create-admin.ts

# 7. Start development server
npm run dev -w apps/api      # API on :3000
npm run dev -w apps/web      # Web on :5173
```

## Running Tests

```bash
# All workspaces
npm test

# API only
npm test -w apps/api

# Web only
npm test -w apps/web

# With coverage
npm run test:coverage -w apps/api
```

## Linting & Type-checking

```bash
npm run lint
npm run typecheck
```

## Database Migrations

```bash
# Apply to app database
npm run db:migrate

# Apply to app_test database
npm run db:migrate:test
```

## Environment Variables

See [`.env.example`](.env.example) for all variables with descriptions and defaults.

## Deployment

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) (created in TASK-113 through TASK-122).

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system diagrams and design
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — engineering decisions not specified in the plan
- [`plan/feature-reward-penalty-platform-1.md`](plan/feature-reward-penalty-platform-1.md) — single source of truth
