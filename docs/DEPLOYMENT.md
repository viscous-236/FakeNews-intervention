# Deployment Guide

## Prerequisites

- Docker Desktop (or Docker Engine + Compose)
- Node.js (see `.nvmrc`)
- Python 3.12 (for detector development)

## Local Development

```bash
# 1. Copy env file and fill in values
cp .env.example .env

# 2. Start infrastructure (PostgreSQL, SeaweedFS, Mailpit, Detector)
docker compose up -d

# 3. Wait for all services to be healthy
docker compose ps

# 4. Run API migrations
npm run db:migrate

# 5. Start API dev server
npm run dev --workspace=apps/api
```

## Detector Service

The detector service is containerized and includes the pretrained model.

### First-Time Build

```bash
# Build the detector image (downloads ~500MB model weights)
docker compose build detector

# Start the detector
docker compose up -d detector
```

The model is downloaded at **build time** from HuggingFace and baked into
the image. No internet access is required at runtime.

### Local Development (without Docker)

```bash
cd services/detector

# Install production dependencies
pip install -r requirements.txt

# Download the model (first time only)
python scripts/download_model.py

# Start the server
DETECTOR_API_KEY=test-key uvicorn app.main:app --host 0.0.0.0 --port 8001

# Run tests (requires model to be downloaded)
pip install -r requirements-train.txt
pytest tests/
```

### Run Evaluation

```bash
cd services/detector
pip install -r requirements-train.txt

# Evaluate on LIAR test split
python scripts/evaluate_model.py

# Select thresholds from LIAR validation split
python scripts/select_thresholds.py
```

## Detection Thresholds

| Variable              | Default | Source         |
|:----------------------|:--------|:---------------|
| `FAKE_THRESHOLD_HIGH` | `0.65`  | Provisional default — run `select_thresholds.py` for data-driven value |
| `REAL_THRESHOLD_LOW`  | `0.35`  | Provisional default — run `select_thresholds.py` for data-driven value |

> **Note:** Thresholds labeled "provisional_default" have NOT been validated on
> evaluation data. Do not rely on them for auto-real assessments in production
> without first running `scripts/select_thresholds.py`.

Bands are computed by the Node.js API (RUL-027), not the detector service.

## Host Memory Requirements

| Service | Estimated RAM |
|:--------|:-------------|
| Detector (CPU, RoBERTa-base) | ~500 MB |
| API | ~256 MB |
| PostgreSQL | ~128 MB |
| SeaweedFS | ~64 MB |
| Mailpit | ~32 MB |

> **CON-008:** Free-tier provider limits (sleep, memory, storage) must be
> re-verified at deploy time. Update this table with actual measured values.

## Production Deployment

See plan Section 1.1 (Deployment architecture).

```
Users → Render Web Service "api-web" (Docker: API + built SPA)
          ├─ SQL → Neon PostgreSQL 16
          ├─ HTTPS → Render Web Service "detector" (Docker: FastAPI + model)
          ├─ S3 → Cloudflare R2 bucket
          └─ SMTP → transactional SMTP provider
```

### Environment Variables (Production)

Set all variables from `.env.example` in your hosting provider's secrets.

Critical:
- `DETECTOR_API_KEY` — must match between API and detector containers
- `DETECTOR_URL` — URL of the deployed detector service
- `DATABASE_URL` — Neon PostgreSQL connection string
- `S3_*` — Cloudflare R2 credentials

## Detector API Contract

```
POST /v1/predict      — classify text, return p_fake
GET  /healthz         — liveness + model-readiness (no auth)
GET  /v1/model-info   — model metadata (requires X-Detector-Key)
```

Port: 8001 (local), 80/443 (production via Render).

## API Detection Operations

- `GET /readyz` returns `{db, migrations, detector}` booleans. HTTP 200 requires
  a reachable database and every bundled SQL migration in `pgmigrations`.
  Detector downtime is reported but does not prevent the API serving posts.
  Missing migration files or unapplied migrations return HTTP 503.
- `GET /api/v1/admin/detector/status` returns live health and model metadata;
  unavailable metadata is `null`.
- `POST /api/v1/admin/posts/:id/redetect` queues the current original-post
  revision and returns HTTP 202 `{detectionId}`.
- `POST /api/v1/admin/detections/:id/requeue` accepts only `failed_permanent`
  jobs, resets retry state, and returns HTTP 202. Other states return 409.
- Both queue mutations require an active administrator and record an
  audit entry. Neither changes assessments or reputation.

The worker reads historical text for old revisions and fences completion by the
claim timestamp, so an expired worker cannot overwrite a replacement claim.
Notifications are published after the database commit. The API build copies
SQL migrations into `dist/db/migrations` for production readiness checks.

## Governance and Appeals

- `POST /api/v1/events/:id/appeal` accepts a 20–1000 character reason for an
  owned, non-voided negative event during `APPEAL_WINDOW_DAYS`. Eligible events
  become held and leave the current wave. Admins receive `appeal_opened`.
- `GET /api/v1/me/appeals` lists the caller's appeals with cursor pagination.
- `GET /api/v1/admin/appeals` supports `status`, `limit`, and cursor filters.
- `POST /api/v1/admin/appeals/:id/resolve` accepts `upheld` or `overturned`.
  Upheld held events return to the open wave. Overturned appeals require
  `newVerdict` (`real` or `unverifiable`) and rationale, then supersede the
  assessment and record `new_assessment_id`.
- Appeal resolution enforces administrator conflict-of-interest checks,
  immutable counted events, append-only audit records, and after-commit
  `appeal_resolved` notifications.

Administrator operations also expose `GET /api/v1/admin/users`,
`GET /api/v1/admin/users/:id`, suspend/unsuspend actions, post release/delete,
`GET /api/v1/admin/audit`, wave and ledger inspection, wave finalization, and
`POST /api/v1/admin/verify-scores`. These routes require an active
administrator; mutating actions create audit records.
