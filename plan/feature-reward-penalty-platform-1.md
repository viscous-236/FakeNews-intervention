---
goal: Build a production-grade Twitter-like platform with a real fake-news detector and the paper's wave-based reward-penalty scoring framework (Q(w+1) = Q(w) + sigma * R(w)), with no mocked components
version: 1.0
date_created: 2026-10-14
last_updated: 2026-10-14
owner: Project owner (undergraduate CS mini project, extended scope)
status: 'Planned'
tags: [feature, architecture, full-stack, machine-learning, scoring, governance]
---

# Introduction

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

This plan is the single source of truth for building the platform end to end. It is written for autonomous execution by a coding agent or a human. Every binding decision (stack, schema, API, scoring rules, detector behaviour, configuration values) is stated in Section 1. Section 2 contains ordered, atomic tasks grouped into phases. There is no time limit: the plan includes every feature in scope, and phases are ordered by dependency, not by calendar.

**Source paper:** "Towards A Platform-Level Reward-Penalty Framework for Misinformation Intervention on Social Media". The paper defines only: `Q_i(w+1) = Q_i(w) + sigma_i * R_i(w)`, `Q_i(1) = 0`, `sigma_i` in [0,1] fixed at initialization, `R_i(w)` computed once per wave (illustration: `R = n_plus - n_minus`), and the properties decomposition, monotonicity and sensitivity scaling. Everything else in this plan (waves as admin-finalized periods, event rules, detector, labels, tiers, appeals) is an engineering decision, labelled as such, and must not be attributed to the authors.

**No-mock policy (binding):** the product contains no mock detector, no fake data path, no feature flag that fabricates predictions, and no stubbed service in any runtime environment. Development, tests, CI and production all use the real PostgreSQL database, the real trained detector service, a real S3-compatible object store, and a real SMTP server (Mailpit locally, which is a real SMTP server that captures mail). The only test-only artifact is `tools/fault-server`, a real HTTP server that deliberately misbehaves so that failure handling of the detection client can be tested (REQ-002).

## 1. Requirements & Constraints

### 1.1 System architecture

```
                              ┌───────────────────────────────────────────────┐
  Browser (React SPA)  ─────▶ │  API process (Node.js + Express 5, 1 instance)│
  HTTPS, cookie "sid"         │  ├─ HTTP /api/v1/*   (REST, JSON)             │
  SSE + WebSocket             │  ├─ WebSocket /ws   (direct messages)     │
                              │  ├─ Static files: built React app (prod)      │
                              │  ├─ Modules: auth, users, posts, feed, media, │
                              │  │   social, search, notifications, messages, │
                              │  │   governance, admin, score, analytics      │
                              │  ├─ scoring/  (pure math + finalizeWave tx)   │
                              │  └─ Background loops (same process):          │
                              │     detection worker, auto-real job,          │
                              │     wave scheduler, email outbox,             │
                              │     media cleanup                             │
                              └──────┬───────────────┬───────────────┬────────┘
                                     │ SQL (pg)      │ HTTPS         │ S3 API / SMTP
                                     ▼               ▼               ▼
                              PostgreSQL 16     Detector service   Object storage (S3-compatible)
                              (system of        (FastAPI, Python)  SMTP server
                               record)          POST /v1/predict
```

**Process model.** The API runs as exactly one instance (CON-003). Realtime fan-out uses an in-process event bus (`apps/api/src/realtime/bus.ts`). Background loops run inside the API process. The detection queue uses `SELECT ... FOR UPDATE SKIP LOCKED`, so it remains correct if a second instance is ever started, but realtime delivery would not (documented limitation).

**Component responsibilities**

| Component | Responsibility | Must never do |
|---|---|---|
| React SPA (`apps/web`) | Rendering, forms, client-side validation for UX, optimistic UI for likes only | Compute or cache scores as truth; call the detector; decide labels |
| API (`apps/api`) | Auth, authorization, validation, business rules, orchestration, realtime, background loops | Trust client-supplied scores, roles or labels |
| PostgreSQL | Source of truth; enforces invariants (constraints, triggers, row locks) | Hold business logic beyond invariants and views |
| Detector (`services/detector`) | Stateless `text -> p_fake` | Decide labels, thresholds, penalties or reputation |
| Scoring engine (`apps/api/src/scoring`) | Event creation, wave finalization, Equation 2, verification, corrections | Read detector output directly (it consumes events only) |
| Object storage | Store re-encoded images | Store anything else |
| SMTP | Verification and reset mail | Carry any score or label information |

**Communication contracts**

| From | To | Protocol | Auth | Timeout | Failure behaviour |
|---|---|---|---|---|---|
| Browser | API | HTTPS JSON, cookie `sid` (httpOnly, Secure, SameSite=Lax) | Session cookie | 30 s client | Error envelope (Section 1.7) |
| Browser | API SSE | `text/event-stream` | Session cookie | Reconnect with backoff 1 s to 30 s | Client falls back to polling `GET /notifications` every 30 s |
| Browser | API WS | WebSocket `/ws` | Session cookie on upgrade | Ping every 25 s | Client reconnects with backoff |
| API | Detector | HTTPS JSON | Header `X-Detector-Key` | 15 s (90 s warm-up) | Detection row `failed`, retry with backoff (RUL-026) |
| API | PostgreSQL | TCP (`pg` pool) | `DATABASE_URL` | 10 s statement timeout | 503 `UNAVAILABLE` |
| API | S3 | HTTPS (AWS SDK v3) | Access key | 20 s | 502 `UPSTREAM_FAILED` on upload |
| API | SMTP | SMTP (Nodemailer) | `SMTP_USER`/`SMTP_PASS` | 15 s | Token row kept, mail send retried by `emailOutbox` loop (REQ-040) |

**Deployment architecture (production)**

```
 Users ─HTTPS─▶ Render Web Service "api-web" (Docker: API + built SPA)
                    │──SQL──▶ Neon PostgreSQL 16
                    │──HTTPS▶ Render Web Service "detector" (Docker: FastAPI + model)
                    │──S3───▶ Cloudflare R2 bucket (any S3-compatible service works unchanged)
                    └──SMTP─▶ transactional SMTP provider
 Local/CI: docker-compose runs postgres:16, minio, mailpit, detector, api.
```

### 1.2 Technology stack (exact)

| Layer | Choice | Notes |
|---|---|---|
| Runtime | Node.js Active LTS at implementation time (minimum 22), recorded in `.nvmrc` | |
| Language | TypeScript, `strict: true`, `noUncheckedIndexedAccess: true` | API, web, shared, tools |
| Monorepo | npm workspaces: `apps/api`, `apps/web`, `packages/shared`, `tools/fault-server` | `services/detector` is Python, outside workspaces |
| API framework | Express 5 | Native async error propagation |
| Validation | Zod, schemas in `packages/shared` | Shared by API and web |
| Database | PostgreSQL 16 (minimum 16) | Extensions: `pgcrypto`, `pg_trgm` |
| DB access | `pg` (node-postgres) with hand-written SQL in repository files; migrations by `node-pg-migrate` using plain `.sql` files | No ORM |
| Decimal math | `decimal.js` | Scores are never JavaScript floats |
| Auth | Server-side sessions in DB; password hashing `argon2` (argon2id, memoryCost 19456 KiB, timeCost 2, parallelism 1) | |
| Security middleware | `helmet`, `express-rate-limit` (memory store), custom Origin check | |
| Logging | `pino`, `pino-http` | JSON lines |
| Metrics | `prom-client` at `GET /metrics` guarded by `METRICS_TOKEN` | |
| Error monitoring | `@sentry/node` and `@sentry/react`, active only when `SENTRY_DSN` is set | |
| Images | `multer` (memory storage), `sharp` for validation and re-encode, `@aws-sdk/client-s3` | |
| Email | `nodemailer` | |
| WebSocket | `ws` | |
| Frontend | React (latest stable major), Vite, TypeScript, Tailwind CSS, React Router, TanStack Query | |
| Detector | Python 3.12, FastAPI, Uvicorn, scikit-learn, joblib, pydantic; training also uses `datasets`, `pandas`, `matplotlib`; transformer path uses `torch`, `transformers` | |
| Tests | Vitest (api, shared, web), Supertest, Playwright, axe-core (via `@axe-core/playwright`), pytest (detector), `autocannon` (load) | |
| CI | GitHub Actions | |
| Containers | Docker, docker-compose | |
| Hosting | Render (API+SPA, detector), Neon (PostgreSQL), Cloudflare R2 (objects), SMTP provider | Provider limits must be re-verified at deploy time (TASK-121) |

### 1.3 Domain model and binding rules

- **RUL-001**: Definitions. A **prediction** is a `detection_results` row (model output, may be wrong). An **assessment** is an `assessments` row (reviewed verdict real/fake/unverifiable with rationale, or the narrow `auto_real` rule). A **reputation event** is a `reputation_events` row, created only from an assessment or a reversal. Only reputation events influence scores. A prediction never creates an event.
- **RUL-002**: Negative events (`MISINFO_POST`, `MISINFO_RESHARE`) are created only from assessments with `source = 'admin'` and `verdict = 'fake'`. The `auto_real` source may only create `RESPONSIBLE_POST` events.
- **RUL-003**: Event kinds: `RESPONSIBLE_POST` (+1), `VALID_REPORT` (+1), `MISINFO_POST` (-1), `MISINFO_RESHARE` (-1), `REVERSAL` (+1 or -1, always opposite to the event it reverses). Likes, comments, follows, messages and blocks never create events.
- **RUL-004**: Event generation when an assessment A is created for original post P with author U:
  - verdict `real` (admin or auto_real): `RESPONSIBLE_POST` for U.
  - verdict `fake` (admin): `MISINFO_POST` for U; `MISINFO_RESHARE` for every user with a non-deleted reshare of P at that moment (only if `RESHARE_PENALTY_ENABLED=true`); `VALID_REPORT` for every reporter with an open report on P (reporter must not be U); all open reports on P become `resolved`. A reshare created while the current verdict is `fake` creates `MISINFO_RESHARE` immediately.
  - verdict `unverifiable`: no events; open reports become `resolved`.
  - Each (assessment, user, kind) pair yields at most one event (database unique index).
- **RUL-005**: Caps. For kind `RESPONSIBLE_POST`, at most `MAX_RESPONSIBLE_POST_EVENTS_PER_WAVE` non-voided events per user per wave; for `VALID_REPORT`, at most `MAX_VALID_REPORT_EVENTS_PER_WAVE`. An event beyond the cap is inserted with `status = 'voided'`, `void_reason = 'cap_exceeded'`. Negative events have no cap.
- **RUL-006**: Waves. A wave is an assessment period. Exactly one wave is `open` at any time (partial unique index). The migration creates wave number 1 as open. Finalizing wave w opens wave w+1 in the same transaction. Finalization is triggered by an admin (`POST /admin/waves/:id/finalize`) or by the scheduler when `WAVE_AUTO_FINALIZE_INTERVAL_HOURS > 0` and `opened_at + interval <= now()`.
- **RUL-007**: A new event attaches to the wave that is open at the moment the event becomes eligible (`wave_id` = open wave id, status `eligible`). Event creation locks the open wave row with `FOR SHARE`; finalization locks it with `FOR UPDATE`, so both serialize.
- **RUL-008**: An event whose assessment has an open appeal is `held` with `wave_id = NULL`. On appeal `upheld` it becomes `eligible` with `wave_id` = currently open wave. On `overturned` RUL-015 applies.
- **RUL-009**: Wave-level reputation `R_i(w) = n_pos - n_neg + n_adj`, where for user i and wave w over events with `wave_id = w` and `status = 'eligible'`: `n_pos` = count of kinds `RESPONSIBLE_POST` and `VALID_REPORT`; `n_neg` = count of kinds `MISINFO_POST` and `MISINFO_RESHARE`; `n_adj` = sum of `value` over kind `REVERSAL`. Without reversals this is exactly the paper's Equation 1. The score update is exactly Equation 2: `q_after = q_before + sigma * R`.
- **RUL-010**: Sigma policy. `sigma` is set once at account creation. Registration through the API uses `SIGMA_DEFAULT` (0.500). The CLI `scripts/create-user.ts --sigma <0..1>` may set another value at creation. No API endpoint, admin action or SQL path may change sigma (database trigger). Sigma is never derived from age, verification, followers or engagement.
- **RUL-011**: Tiers. `trusted` if `q >= Q_TRUSTED_MIN`; `low` if `q <= Q_LOW_MAX`; otherwise `neutral`. Tier is derived at read time from `users.q`. Posts store `author_tier_at_post` at creation for analytics.
- **RUL-012**: Public label of a post (computed by view `post_public_status_v`): current assessment verdict `fake` gives `fact_checked_false`; verdict `real` with source `admin` gives `fact_checked_true`; verdict `real` with source `auto_real` gives `none`; verdict `unverifiable` gives `unverifiable`; with no current assessment, latest detection band `likely_fake` gives `auto_flagged`; everything else `none`. A boolean `under_appeal` is true when any event of the current assessment has an open appeal.
- **RUL-013**: Review queue (view `review_queue_v`): original posts with no current assessment that satisfy at least one of: latest detection band in (`likely_fake`, `uncertain`); latest detection status `failed_permanent`; at least one open report; post status `held`. Deleted posts are included only if they have at least one reshare, one open report, or band `likely_fake`. Priority = `3 * open_reports + reshares + (5 if band = likely_fake, 2 if uncertain, else 0)`; order priority descending, then `created_at` ascending.
- **RUL-014**: Auto-real rule (when `AUTO_REAL_ENABLED=true`, job runs every 60 s): create an assessment with `source = 'auto_real'`, `verdict = 'real'`, rationale `'Automated: low model risk, no reports, review window elapsed.'` for original posts where: status `published`, latest detection `ok` for the current revision with `p_fake <= REAL_THRESHOLD_LOW`, zero reports (any status), no assessment ever, `created_at <= now() - AUTO_REAL_DELAY_MINUTES minutes`, author status `active`.
- **RUL-015**: Supersede cascade. Creating an assessment for a post that already has a current assessment: set the old one `is_current = false` (the only permitted update), insert the new one with `supersedes_id`. For every event of the old assessment: status `eligible` or `held` becomes `voided` with reason `assessment_superseded`; status `counted` leaves the event untouched and inserts a `REVERSAL` event (same user, value = -original value, `reverses_event_id`, status `eligible`, `wave_id` = open wave). Then RUL-004 runs for the new assessment. Reports resolved earlier stay resolved.
- **RUL-016**: Appeals. Any user holding a non-voided negative event may open one appeal for that event within `APPEAL_WINDOW_DAYS` of the assessment `created_at`. Opening sets the event `held` (if `eligible`; if `counted` the event stays counted and the appeal can only result in a reversal). Admin resolves as `upheld` (RUL-008) or `overturned` with a required new verdict `real` or `unverifiable`, which creates a superseding assessment via RUL-015 and records `new_assessment_id`.
- **RUL-017**: Post edit. Author may edit body and source_url only when: status is not `deleted`, age <= `EDIT_WINDOW_MINUTES`, no assessment exists, no open report exists. Editing increments `revision`, stores the previous body in `post_revisions`, and enqueues a new detection row for the new revision.
- **RUL-018**: Post deletion is soft (`status = 'deleted'`, `deleted_at`). Deletion never cancels assessments, events, reports or appeals. Deleted posts disappear from feeds, search and profiles; they remain visible to admins and in the author's score history.
- **RUL-019**: Reshares. A reshare is a `posts` row with `kind = 'reshare'` pointing to an original post (never to another reshare). One non-deleted reshare per (user, original). Optional comment up to 500 chars. If the original's label is `auto_flagged`, `fact_checked_false` or the author's tier is `low`, the request must include `acknowledgedWarning = true`, otherwise 409 `CONFIRMATION_REQUIRED`. Reshares are not sent to the detector. Deleting a reshare before the verdict removes it from RUL-004 (retraction).
- **RUL-020**: Reports. One report per (user, post). A user cannot report their own post. Reports on deleted posts are rejected with 404. Report reasons: `false_information`, `misleading`, `spam`, `harassment`, `other`.
- **RUL-021**: Conflict of interest. An admin cannot create an assessment or resolve an appeal for a post they authored, reshared or reported. Violations return 403 `CONFLICT_OF_INTEREST`.
- **RUL-022**: Suspended users cannot post, comment, like, follow, message or report, but can log in and view their score and appeals. Account deletion anonymizes PII (username `deleted_` + first 8 hex chars of id, email `deleted+<id>@invalid.local`, display name `Deleted user`, bio empty, avatar removed, password hash replaced), sets `status = 'deleted'`, deletes sessions, keeps posts, ledger and events. Ledger rows exist for users of every status.
- **RUL-023**: Visibility. Public users see: label, `under_appeal`, author tier badge, counts. The author and admins additionally see detection status and band, and for admins also `p_fake`, model name and version. Numeric `q` and sigma are visible only to the user and admins when `PUBLIC_SCORE_VISIBILITY = 'tier_only'` (default); `'full'` makes `q` public (sigma stays private).
- **RUL-024**: Low-tier hold. When `HOLD_LOW_TIER_POSTS=true`, a new original post by a user whose tier is `low` gets `status = 'held'` (visible only to the author and admins) and appears in the review queue. An admin releases it (`POST /admin/posts/:id/release`, status `published`) or removes it (`DELETE /admin/posts/:id`, status `deleted`). Default is `false`.
- **RUL-025**: Notification types: `post_flagged`, `assessment_decided`, `appeal_opened`, `appeal_resolved`, `report_resolved`, `wave_finalized`, `new_follower`, `like`, `comment`, `reshare`, `message`. Each is created in the same transaction as the triggering change and pushed to SSE after commit. Users never receive a notification about their own action.
- **RUL-026**: Detection lifecycle. On post create or edit insert a `detection_results` row `queued`. Worker claims rows with `status IN ('queued','failed') AND next_attempt_at <= now()` using `FOR UPDATE SKIP LOCKED`, sets `running`. Success: status `ok` with `p_fake`, `band`, model fields. Failure: `attempts += 1`; if `attempts < DETECTOR_MAX_ATTEMPTS` status `failed` and `next_attempt_at = now() + DETECTOR_BACKOFF_SECONDS[attempts-1]`; else `failed_permanent`. A `running` row older than 120 s is reset to `failed` by the worker. A failed prediction never creates a label, assessment or event.
- **RUL-027**: Bands. `p_fake >= FAKE_THRESHOLD_HIGH` gives `likely_fake`; `p_fake <= REAL_THRESHOLD_LOW` gives `likely_real`; otherwise `uncertain`. Bands are computed by the API, not the detector.
- **RUL-028**: Blocks. If A blocks B: B cannot follow A, message A, comment on A's posts or reshare A's posts; existing follows in both directions are deleted; A's posts are hidden from B's feed and search. Blocks do not affect scoring.
- **RUL-029**: Who-to-follow. Candidates are users followed by users the viewer follows, excluding the viewer, already-followed users, blocked users (either direction), and suspended or deleted users. Rank by number of mutual followed-by connections descending, then `created_at` descending. If fewer than 10 candidates, fill with the most-followed active users not already excluded. The ranking never uses `q` or tier.
- **RUL-030**: Search. Posts: PostgreSQL full text (`websearch_to_tsquery('english', q)` against `body_tsv`), published posts only, ordered by `ts_rank` descending then `created_at` descending. Users: `username ILIKE q || '%'` or `similarity(display_name, q) > 0.3`, ordered by similarity descending. Minimum query length 2.
- **RUL-031**: Feeds. Global feed and Following feed are strictly chronological (`created_at` descending, `id` descending) with cursor pagination. No ranking or demotion by reputation (the paper's amplification signals are expressed only through labels, tiers, confirmation prompts and the optional hold in RUL-024).

### 1.4 Database specification (binding DDL)

Migrations are plain SQL files in `apps/api/src/db/migrations/`, applied in filename order. The DDL below is normative; column names, types, checks and indexes must match exactly. All timestamps are `timestamptz`. All primary keys are `uuid DEFAULT gen_random_uuid()` unless stated.

```sql
-- 0001_core_identity.sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9_]{3,20}$'),
  email text NOT NULL,
  password_hash text NOT NULL,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 50),
  bio text NOT NULL DEFAULT '' CHECK (char_length(bio) <= 160),
  avatar_media_id uuid,
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','deleted')),
  sigma numeric(4,3) NOT NULL CHECK (sigma >= 0 AND sigma <= 1),
  q numeric(14,3) NOT NULL DEFAULT 0,
  email_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX users_email_lower_uq ON users (lower(email));

-- sigma is immutable; q may change only inside a transaction that ran: SET LOCAL app.scoring = 'on'
CREATE FUNCTION users_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.sigma IS DISTINCT FROM OLD.sigma THEN
    RAISE EXCEPTION 'sigma is immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.q IS DISTINCT FROM OLD.q AND COALESCE(current_setting('app.scoring', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'q may only be changed by the scoring engine' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER users_guard_trg BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION users_guard();

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  user_agent text,
  ip inet
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE email_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('verify_email','reset_password')),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  to_email text NOT NULL,
  subject text NOT NULL,
  body_text text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed_permanent')),
  attempts int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX email_outbox_due_idx ON email_outbox (next_attempt_at) WHERE status = 'queued';

CREATE TABLE media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id),
  kind text NOT NULL CHECK (kind IN ('avatar','post_image')),
  object_key text NOT NULL UNIQUE,
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg','image/png','image/webp')),
  bytes int NOT NULL CHECK (bytes > 0),
  width int NOT NULL, height int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE users ADD CONSTRAINT users_avatar_fk FOREIGN KEY (avatar_media_id) REFERENCES media(id);

-- 0002_posts_detection.sql
CREATE TABLE posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id uuid NOT NULL REFERENCES users(id),
  kind text NOT NULL CHECK (kind IN ('original','reshare')),
  reshare_of_post_id uuid REFERENCES posts(id),
  body text NOT NULL DEFAULT '' CHECK (char_length(body) <= 500),
  source_url text CHECK (source_url IS NULL OR (char_length(source_url) <= 2048 AND source_url ~ '^https?://')),
  revision int NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('published','held','deleted')),
  author_tier_at_post text NOT NULL CHECK (author_tier_at_post IN ('trusted','neutral','low')),
  body_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', body)) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  CHECK (
    (kind = 'original' AND reshare_of_post_id IS NULL AND char_length(body) >= 20)
    OR (kind = 'reshare' AND reshare_of_post_id IS NOT NULL)
  )
);
CREATE INDEX posts_feed_idx ON posts (created_at DESC, id DESC) WHERE status = 'published';
CREATE INDEX posts_author_idx ON posts (author_id, created_at DESC, id DESC);
CREATE INDEX posts_tsv_idx ON posts USING gin (body_tsv);
CREATE UNIQUE INDEX posts_one_reshare_uq ON posts (author_id, reshare_of_post_id)
  WHERE kind = 'reshare' AND status <> 'deleted';
CREATE INDEX posts_reshare_of_idx ON posts (reshare_of_post_id) WHERE kind = 'reshare';

CREATE FUNCTION posts_reshare_target_original() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind = 'reshare' AND (SELECT kind FROM posts WHERE id = NEW.reshare_of_post_id) <> 'original' THEN
    RAISE EXCEPTION 'reshare target must be an original post' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER posts_reshare_target_trg BEFORE INSERT ON posts FOR EACH ROW EXECUTE FUNCTION posts_reshare_target_original();

CREATE TABLE post_revisions (
  post_id uuid NOT NULL REFERENCES posts(id),
  revision int NOT NULL,
  body text NOT NULL,
  source_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, revision)
);

CREATE TABLE post_media (
  post_id uuid NOT NULL REFERENCES posts(id),
  media_id uuid NOT NULL REFERENCES media(id),
  position smallint NOT NULL CHECK (position BETWEEN 0 AND 3),
  PRIMARY KEY (post_id, media_id),
  UNIQUE (post_id, position)
);

CREATE TABLE detection_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES posts(id),
  post_revision int NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','ok','failed','failed_permanent')),
  attempts int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  request_id uuid NOT NULL DEFAULT gen_random_uuid(),
  model_name text,
  model_version text,
  p_fake numeric(6,5) CHECK (p_fake IS NULL OR (p_fake >= 0 AND p_fake <= 1)),
  band text CHECK (band IS NULL OR band IN ('likely_fake','uncertain','likely_real')),
  latency_ms int,
  error_code text,
  error_detail text,
  raw_response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK (status <> 'ok' OR (p_fake IS NOT NULL AND band IS NOT NULL AND model_name IS NOT NULL AND model_version IS NOT NULL))
);
CREATE INDEX detection_due_idx ON detection_results (next_attempt_at) WHERE status IN ('queued','failed');
CREATE INDEX detection_post_idx ON detection_results (post_id, created_at DESC);

-- 0003_governance_scoring.sql
CREATE TABLE waves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number int NOT NULL UNIQUE CHECK (number >= 1),
  status text NOT NULL CHECK (status IN ('open','finalized')),
  opened_at timestamptz NOT NULL DEFAULT now(),
  finalized_at timestamptz,
  finalized_by uuid REFERENCES users(id),
  finalized_by_system boolean NOT NULL DEFAULT false,
  formula_version text NOT NULL DEFAULT 'paper-eq2-v1',
  CHECK ((status = 'open' AND finalized_at IS NULL) OR (status = 'finalized' AND finalized_at IS NOT NULL))
);
CREATE UNIQUE INDEX waves_one_open_uq ON waves ((true)) WHERE status = 'open';
INSERT INTO waves (number, status) VALUES (1, 'open');

CREATE TABLE reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES posts(id),
  reporter_id uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL CHECK (reason IN ('false_information','misleading','spam','harassment','other')),
  details text NOT NULL DEFAULT '' CHECK (char_length(details) <= 500),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, reporter_id)
);
CREATE INDEX reports_post_open_idx ON reports (post_id) WHERE status = 'open';

CREATE TABLE assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES posts(id),
  post_revision int NOT NULL,
  verdict text NOT NULL CHECK (verdict IN ('real','fake','unverifiable')),
  source text NOT NULL CHECK (source IN ('admin','auto_real')),
  decided_by uuid REFERENCES users(id),
  rationale text NOT NULL CHECK (char_length(rationale) >= 10 AND char_length(rationale) <= 2000),
  detection_result_id uuid REFERENCES detection_results(id),
  supersedes_id uuid REFERENCES assessments(id),
  is_current boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (source = 'admin' AND decided_by IS NOT NULL)
    OR (source = 'auto_real' AND decided_by IS NULL AND verdict = 'real')
  )
);
CREATE UNIQUE INDEX assessments_one_current_uq ON assessments (post_id) WHERE is_current;
CREATE UNIQUE INDEX assessments_one_successor_uq ON assessments (supersedes_id) WHERE supersedes_id IS NOT NULL;

-- append-only: the only permitted UPDATE is is_current true -> false
CREATE FUNCTION assessments_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'assessments are append-only'; END IF;
  IF (to_jsonb(NEW) - 'is_current') IS DISTINCT FROM (to_jsonb(OLD) - 'is_current')
     OR NOT (OLD.is_current = true AND NEW.is_current = false) THEN
    RAISE EXCEPTION 'assessments are append-only; only is_current true->false is allowed';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER assessments_guard_trg BEFORE UPDATE OR DELETE ON assessments FOR EACH ROW EXECUTE FUNCTION assessments_guard();

CREATE TABLE user_wave_reputation (
  user_id uuid NOT NULL REFERENCES users(id),
  wave_id uuid NOT NULL REFERENCES waves(id),
  n_pos int NOT NULL CHECK (n_pos >= 0),
  n_neg int NOT NULL CHECK (n_neg >= 0),
  n_adj int NOT NULL,
  r int NOT NULL,
  sigma_used numeric(4,3) NOT NULL CHECK (sigma_used >= 0 AND sigma_used <= 1),
  q_before numeric(14,3) NOT NULL,
  delta numeric(14,3) NOT NULL,
  q_after numeric(14,3) NOT NULL,
  formula_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, wave_id),
  CHECK (r = n_pos - n_neg + n_adj),
  CHECK (delta = sigma_used * r),
  CHECK (q_after = q_before + delta)
);

CREATE TABLE reputation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  post_id uuid NOT NULL REFERENCES posts(id),
  assessment_id uuid NOT NULL REFERENCES assessments(id),
  report_id uuid REFERENCES reports(id),
  kind text NOT NULL CHECK (kind IN ('RESPONSIBLE_POST','VALID_REPORT','MISINFO_POST','MISINFO_RESHARE','REVERSAL')),
  value smallint NOT NULL CHECK (value IN (-1, 1)),
  status text NOT NULL CHECK (status IN ('eligible','held','voided','counted')),
  wave_id uuid REFERENCES waves(id),
  reverses_event_id uuid REFERENCES reputation_events(id),
  void_reason text,
  ledger_user_id uuid,
  ledger_wave_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (ledger_user_id, ledger_wave_id) REFERENCES user_wave_reputation (user_id, wave_id),
  CHECK (
    (kind IN ('RESPONSIBLE_POST','VALID_REPORT') AND value = 1)
    OR (kind IN ('MISINFO_POST','MISINFO_RESHARE') AND value = -1)
    OR (kind = 'REVERSAL' AND reverses_event_id IS NOT NULL)
  ),
  CHECK ((status IN ('eligible','counted') AND wave_id IS NOT NULL) OR status IN ('held','voided')),
  CHECK (status <> 'voided' OR void_reason IS NOT NULL),
  CHECK (status <> 'counted' OR (ledger_user_id = user_id AND ledger_wave_id = wave_id))
);
CREATE UNIQUE INDEX events_one_per_assessment_uq ON reputation_events (assessment_id, user_id, kind) WHERE kind <> 'REVERSAL';
CREATE UNIQUE INDEX events_one_reversal_uq ON reputation_events (reverses_event_id) WHERE kind = 'REVERSAL' AND status <> 'voided';
CREATE INDEX events_wave_idx ON reputation_events (wave_id, user_id) WHERE status = 'eligible';
CREATE INDEX events_user_idx ON reputation_events (user_id, created_at DESC);

-- counted events and ledger rows are immutable
CREATE FUNCTION events_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'reputation_events are never deleted'; END IF;
  IF OLD.status = 'counted' THEN RAISE EXCEPTION 'counted events are immutable'; END IF;
  IF NEW.status = 'counted' AND COALESCE(current_setting('app.scoring', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'events may only become counted inside wave finalization';
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END $$;
CREATE TRIGGER events_guard_trg BEFORE UPDATE OR DELETE ON reputation_events FOR EACH ROW EXECUTE FUNCTION events_guard();

CREATE FUNCTION ledger_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN RAISE EXCEPTION 'user_wave_reputation is immutable'; END IF;
  IF COALESCE(current_setting('app.scoring', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'ledger rows may only be inserted by the scoring engine';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ledger_guard_trg BEFORE INSERT OR UPDATE OR DELETE ON user_wave_reputation FOR EACH ROW EXECUTE FUNCTION ledger_guard();

CREATE TABLE appeals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL UNIQUE REFERENCES reputation_events(id),
  assessment_id uuid NOT NULL REFERENCES assessments(id),
  appellant_id uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 20 AND 1000),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','upheld','overturned')),
  resolved_by uuid REFERENCES users(id),
  resolution_note text,
  new_assessment_id uuid REFERENCES assessments(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CHECK ((status = 'open' AND resolved_at IS NULL) OR (status <> 'open' AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL AND char_length(coalesce(resolution_note,'')) >= 10))
);

CREATE TABLE admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES users(id),
  actor_kind text NOT NULL CHECK (actor_kind IN ('admin','system')),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  before jsonb,
  after jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((actor_kind = 'admin' AND actor_id IS NOT NULL) OR actor_kind = 'system')
);
CREATE INDEX audit_entity_idx ON admin_audit_log (entity_type, entity_id, created_at DESC);
CREATE FUNCTION audit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'admin_audit_log is append-only'; END $$;
CREATE TRIGGER audit_guard_trg BEFORE UPDATE OR DELETE ON admin_audit_log FOR EACH ROW EXECUTE FUNCTION audit_guard();

-- 0004_social.sql
CREATE TABLE comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES posts(id),
  author_id uuid NOT NULL REFERENCES users(id),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX comments_post_idx ON comments (post_id, created_at ASC, id ASC) WHERE deleted_at IS NULL;

CREATE TABLE likes (
  user_id uuid NOT NULL REFERENCES users(id),
  post_id uuid NOT NULL REFERENCES posts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id)
);
CREATE INDEX likes_post_idx ON likes (post_id);

CREATE TABLE follows (
  follower_id uuid NOT NULL REFERENCES users(id),
  followee_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followee_id),
  CHECK (follower_id <> followee_id)
);
CREATE INDEX follows_followee_idx ON follows (followee_id);

CREATE TABLE blocks (
  blocker_id uuid NOT NULL REFERENCES users(id),
  blocked_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  type text NOT NULL CHECK (type IN ('post_flagged','assessment_decided','appeal_opened','appeal_resolved','report_resolved','wave_finalized','new_follower','like','comment','reshare','message')),
  actor_id uuid REFERENCES users(id),
  post_id uuid REFERENCES posts(id),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC, id DESC);

CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL REFERENCES users(id),
  recipient_id uuid NOT NULL REFERENCES users(id),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  CHECK (sender_id <> recipient_id)
);
CREATE INDEX messages_conv_idx ON messages (LEAST(sender_id, recipient_id), GREATEST(sender_id, recipient_id), created_at DESC, id DESC);
CREATE INDEX messages_unread_idx ON messages (recipient_id) WHERE read_at IS NULL;

-- 0005_search_and_views.sql
CREATE INDEX users_username_trgm_idx ON users USING gin (username gin_trgm_ops);
CREATE INDEX users_display_trgm_idx ON users USING gin (display_name gin_trgm_ops);

CREATE VIEW post_current_assessment_v AS
  SELECT a.* FROM assessments a WHERE a.is_current;

CREATE VIEW post_latest_detection_v AS
  SELECT DISTINCT ON (d.post_id) d.*
  FROM detection_results d
  JOIN posts p ON p.id = d.post_id AND d.post_revision = p.revision
  ORDER BY d.post_id, d.created_at DESC;

CREATE VIEW post_public_status_v AS
  SELECT p.id AS post_id,
    CASE
      WHEN a.verdict = 'fake' THEN 'fact_checked_false'
      WHEN a.verdict = 'real' AND a.source = 'admin' THEN 'fact_checked_true'
      WHEN a.verdict = 'real' AND a.source = 'auto_real' THEN 'none'
      WHEN a.verdict = 'unverifiable' THEN 'unverifiable'
      WHEN a.id IS NULL AND d.band = 'likely_fake' THEN 'auto_flagged'
      ELSE 'none'
    END AS label,
    EXISTS (
      SELECT 1 FROM appeals ap JOIN reputation_events e ON e.id = ap.event_id
      WHERE ap.status = 'open' AND e.assessment_id = a.id
    ) AS under_appeal
  FROM posts p
  LEFT JOIN post_current_assessment_v a ON a.post_id = p.id
  LEFT JOIN post_latest_detection_v d ON d.post_id = p.id AND d.status = 'ok';

CREATE VIEW review_queue_v AS
  SELECT p.id AS post_id,
    (3 * COALESCE(rp.open_reports, 0) + COALESCE(rs.reshares, 0)
      + CASE d.band WHEN 'likely_fake' THEN 5 WHEN 'uncertain' THEN 2 ELSE 0 END) AS priority,
    p.created_at
  FROM posts p
  LEFT JOIN post_latest_detection_v d ON d.post_id = p.id
  LEFT JOIN LATERAL (SELECT count(*) AS open_reports FROM reports r WHERE r.post_id = p.id AND r.status = 'open') rp ON true
  LEFT JOIN LATERAL (SELECT count(*) AS reshares FROM posts s WHERE s.reshare_of_post_id = p.id AND s.kind = 'reshare' AND s.status <> 'deleted') rs ON true
  WHERE p.kind = 'original'
    AND NOT EXISTS (SELECT 1 FROM assessments a WHERE a.post_id = p.id AND a.is_current)
    AND (d.status = 'ok' AND d.band IN ('likely_fake','uncertain')
         OR d.status = 'failed_permanent'
         OR COALESCE(rp.open_reports, 0) > 0
         OR p.status = 'held')
    AND (p.status <> 'deleted' OR COALESCE(rp.open_reports,0) > 0 OR COALESCE(rs.reshares,0) > 0 OR d.band = 'likely_fake');
```

### 1.5 Scoring specification (binding)

**Pure functions** in `apps/api/src/scoring/pure.ts` (no I/O, no database, no clock, no randomness). Use `decimal.js` with `Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_EVEN })`.

| Function | Signature | Definition |
|---|---|---|
| `computeR` | `(c: {nPos: number, nNeg: number, nAdj: number}) => number` | `nPos - nNeg + nAdj` (integers) |
| `applyUpdate` | `(qBefore: Decimal, sigma: Decimal, r: number) => {delta: Decimal, qAfter: Decimal}` | `delta = sigma * r`; `qAfter = qBefore + delta` (Equation 2) |
| `foldHistory` | `(sigma: Decimal, rs: number[]) => Decimal` | Starts at 0, applies `applyUpdate` for each r in order, returns final q |
| `decomposedScore` | `(sigma: Decimal, rs: number[]) => Decimal` | `sigma * sum(rs)` (Proposition 1) |
| `verifyUserHistory` | `(sigma: Decimal, rows: LedgerRow[], currentQ: Decimal) => VerifyIssue[]` | Implements invariants I1 to I5 below on in-memory rows |

`Decimal` values are serialized to and from PostgreSQL `numeric` as strings. JavaScript `number` is allowed only for integer `r`, `nPos`, `nNeg`, `nAdj`.

**`finalizeWave(waveId, actor)`** in `apps/api/src/scoring/finalizeWave.ts`. `actor` is `{kind:'admin', userId}` or `{kind:'system'}`. One database transaction, isolation `READ COMMITTED`:

1. `SET LOCAL app.scoring = 'on'`.
2. `SELECT * FROM waves WHERE id = $1 FOR UPDATE`. If not found: throw `NOT_FOUND`. If `status = 'finalized'`: commit and return `{alreadyFinalized: true, wave, ledgerCount}` (idempotent).
3. `SELECT id, sigma, q FROM users WHERE created_at <= now() ORDER BY id FOR UPDATE` (every user of every status; ordered by id to avoid deadlocks).
4. Aggregate: for the wave, `SELECT user_id, count(*) FILTER (WHERE kind IN ('RESPONSIBLE_POST','VALID_REPORT')) AS n_pos, count(*) FILTER (WHERE kind IN ('MISINFO_POST','MISINFO_RESHARE')) AS n_neg, COALESCE(sum(value) FILTER (WHERE kind = 'REVERSAL'),0) AS n_adj FROM reputation_events WHERE wave_id = $1 AND status = 'eligible' GROUP BY user_id`.
5. For each user (missing aggregate means 0, 0, 0): `r = computeR(...)`; `{delta, qAfter} = applyUpdate(q, sigma, r)`; `INSERT INTO user_wave_reputation (...)` with `formula_version` from the wave row; `UPDATE users SET q = qAfter, updated_at = now() WHERE id = ...`.
6. `UPDATE reputation_events SET status = 'counted', ledger_user_id = user_id, ledger_wave_id = wave_id WHERE wave_id = $1 AND status = 'eligible'`.
7. `UPDATE waves SET status = 'finalized', finalized_at = now(), finalized_by = ..., finalized_by_system = ...` then `INSERT INTO waves (number, status) VALUES (number + 1, 'open')`. (Order matters: finalize the old wave first so the partial unique index never sees two open waves.)
8. Insert `admin_audit_log` row (`action = 'wave.finalize'`, `after` = `{waveNumber, usersScored, eventsCounted}`).
9. Insert one `wave_finalized` notification per user with `r <> 0`, payload `{waveNumber, r, delta, qAfter}`.
10. Commit. After commit, push SSE events.

**Ledger invariants checked by `verifyScores` (`apps/api/src/scoring/verify.ts`)**

- **I1** For each user, ordered by wave number, `q_before` of the first row is 0 and `q_before` of each later row equals `q_after` of the previous row.
- **I2** Every row satisfies `q_after = q_before + sigma_used * r` and `r = n_pos - n_neg + n_adj`.
- **I3** `users.q` equals the `q_after` of the user's latest ledger row (0 if none) and equals `sigma * sum(r)` over all rows (Proposition 1).
- **I4** Every row has `sigma_used = users.sigma`.
- **I5** For each row, `n_pos`, `n_neg`, `n_adj` equal the aggregates over `reputation_events` with `ledger_user_id`/`ledger_wave_id` matching that row and `status = 'counted'`.
- **I6** No event with `status = 'eligible'` has a `wave_id` pointing to a finalized wave.

`verifyScores` returns `{ok: boolean, issues: [{invariant, userId, waveId?, expected, actual}]}` and is exposed through `POST /api/v1/admin/verify-scores` and `scripts/verify-scores.ts` (exit code 1 on any issue).

**Event creation** (`apps/api/src/scoring/events.ts`, function `createEventsForAssessment(tx, assessment)`) implements RUL-004, RUL-005, RUL-007 and RUL-015 inside the caller's transaction. It obtains the open wave with `SELECT id FROM waves WHERE status = 'open' FOR SHARE`.

### 1.6 Detection specification (binding)

**Detector HTTP contract** (`services/detector/app/main.py`)

| Endpoint | Auth | Request | Success response | Errors |
|---|---|---|---|---|
| `POST /v1/predict` | Header `X-Detector-Key` equals env `DETECTOR_API_KEY` | `{"request_id": uuid, "post_id": uuid, "text": string, 1..2000 chars}` | `200 {"request_id": uuid, "model_name": string, "model_version": string, "p_fake": float in [0,1], "latency_ms": int}` | `401 {"error":{"code":"UNAUTHORIZED","message":...}}`, `422 {"error":{"code":"INVALID_INPUT",...}}`, `503 {"error":{"code":"MODEL_NOT_READY",...}}` |
| `GET /healthz` | none | none | `200 {"status":"ok","model_loaded":true}` or `503` when the model is not loaded | |
| `GET /v1/model-info` | `X-Detector-Key` | none | `200 {"model_name","model_version","trained_at","dataset","dataset_sha256","label_mapping","metrics":{"val_macro_f1","test_macro_f1"},"recommended_thresholds":{"fake_high","real_low"}}` | `401` |

`p_fake` is the model's probability that the text belongs to the fake class. The detector never returns a label or band.

**Backend client** (`apps/api/src/detection/client.ts`): validates every response with a Zod schema (`p_fake` finite number in [0,1], non-empty `model_name` and `model_version`, `request_id` equal to the sent one). Error codes recorded in `detection_results.error_code`: `TIMEOUT`, `NETWORK`, `HTTP_401`, `HTTP_422`, `HTTP_5XX`, `MALFORMED_RESPONSE`, `REQUEST_ID_MISMATCH`. Warm-up: if no successful call in the last 10 minutes, the worker first calls `GET /healthz` with `DETECTOR_WARMUP_TIMEOUT_MS`; a failed warm-up counts as a failed attempt.

**Preprocessing** (`services/detector/app/preprocess.py`, used by training and serving): Unicode NFKC normalize; replace URLs matching `https?://\S+` with `<url>`; replace `@\w+` with `<user>`; collapse whitespace to single spaces; strip. Lowercasing is performed by the vectorizer (baseline) or by the tokenizer (transformer).

**Dataset:** LIAR, loaded with `datasets.load_dataset("ucsbnlp/liar")` (Hugging Face), using the provided train, validation and test splits. Read the label names from `dataset["train"].features["label"].names` and map by name, never by integer. Binary mapping: `pants-fire`, `false`, `barely-true` to class 1 (fake); `half-true`, `mostly-true`, `true` to class 0 (real). Only the `statement` field is used as model input. The agent must record the dataset's license text and citation in `docs/DATASETS.md` before training (TASK-029). LIAR consists of short political statements from PolitiFact, so the detector is in-domain only for that style of text; this limitation is stated in `MODEL_CARD.md` and in the UI help text.

**Models (both trained, one deployed)**

| Model | Configuration |
|---|---|
| Baseline `tfidf_lr` | `TfidfVectorizer(ngram_range=(1,2), min_df=2, max_features=100000, sublinear_tf=True, lowercase=True)` then `LogisticRegression(class_weight='balanced', solver='liblinear', max_iter=1000)`; `C` selected from {0.1, 0.3, 1, 3, 10} by validation macro-F1; seed 42 |
| Transformer `distilroberta` | `distilroberta-base` fine-tuned: max_len 128, learning rate 2e-5, batch size 16, epochs 3, weight decay 0.01, warmup ratio 0.1, seed 42, best epoch by validation macro-F1 |

**Selection rule (deterministic):** let `Mb` and `Mt` be validation macro-F1 of baseline and transformer. Deploy the transformer if and only if `Mt - Mb >= 0.02` and `DETECTOR_HOST_MEMORY_MB >= 2048` (the memory of the production detector host, recorded in `docs/DEPLOYMENT.md`; default 512). Otherwise deploy the baseline. Record the outcome and numbers in `services/detector/MODEL_CARD.md`.

**Evaluation (`services/detector/training/evaluate.py`):** on the test split, once, for each model: accuracy, per-class precision, recall, F1, macro-F1, confusion matrix, ROC-AUC, PR-AUC, expected calibration error (10 bins), reliability diagram. Error analysis: write `reports/errors_<model>.csv` with at least 100 misclassified test rows (all if fewer) with columns `statement, label, p_fake`, and categorize 50 of them manually in `reports/error_analysis.md` using these categories: `needs_external_knowledge`, `ambiguous_label`, `too_short`, `topic_bias`, `other`. Outputs: `reports/detector_eval.json`, `reports/detector_eval.md`, PNG figures. Benchmark performance describes the model on LIAR only and must be reported separately from application behaviour.

**Threshold selection (`training/select_thresholds.py`, uses validation split only):** sweep t from 0.50 to 0.95 in steps of 0.01. `fake_high` = smallest t such that precision of class fake among samples with `p_fake >= t` is at least 0.70 and those samples are at least 2 percent of the validation set; if none qualifies, `fake_high = 0.90`. `real_low` = 1 minus the smallest t such that precision of class real among samples with `p_fake <= 1 - t` is at least 0.70 with at least 2 percent coverage; if none qualifies, `real_low = 0.10`. Write `artifacts/thresholds.json`. The task that finishes this step copies both values into `.env.example` (`FAKE_THRESHOLD_HIGH`, `REAL_THRESHOLD_LOW`) and `docs/DEPLOYMENT.md`.

**Artifacts:** `services/detector/artifacts/model.joblib` (baseline) or `artifacts/transformer/` (transformer, tracked with Git LFS), plus `artifacts/metadata.json` (`model_name`, `model_version` = `<model_name>-<first 8 chars of sha256 of the artifact>`, `trained_at`, `dataset`, `dataset_sha256`, `label_mapping`, metrics). The container loads the model once at startup; `/healthz` returns 503 until loaded.

### 1.7 API specification (binding)

**Conventions.** Base path `/api/v1`. JSON request and response bodies (`Content-Type: application/json`) except `POST /media` (multipart) and CSV exports. Authentication by cookie `sid`. All schemas are strict Zod objects; unknown keys are rejected with `VALIDATION_ERROR`. IDs are UUID strings. Timestamps are ISO 8601 UTC strings. `limit` defaults to 20, maximum 50. Cursor pagination: query `?cursor=<opaque>&limit=<n>`, response `{ "items": [...], "nextCursor": string or null }`; the cursor is base64url of `<ISO created_at>|<id>`.

**Error envelope** (all non-2xx): `{ "error": { "code": string, "message": string, "details"?: object, "requestId": string } }`.

| HTTP | code | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Body or query failed Zod validation (`details.fields`) |
| 401 | `UNAUTHENTICATED`, `INVALID_CREDENTIALS` | No or invalid session; bad login |
| 403 | `FORBIDDEN`, `EMAIL_NOT_VERIFIED`, `ACCOUNT_SUSPENDED`, `CONFLICT_OF_INTEREST` | Authorization failures |
| 404 | `NOT_FOUND` | Missing or invisible resource (also used when blocked) |
| 409 | `CONFLICT`, `USERNAME_TAKEN`, `EMAIL_TAKEN`, `CONFIRMATION_REQUIRED`, `EDIT_NOT_ALLOWED`, `APPEAL_NOT_ALLOWED`, `ALREADY_EXISTS` | State conflicts |
| 413 | `PAYLOAD_TOO_LARGE` | Upload above 5 MB |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Not jpeg, png or webp |
| 429 | `RATE_LIMITED` | Includes `Retry-After` header |
| 500 | `INTERNAL` | Unexpected; `requestId` returned |
| 502 | `UPSTREAM_FAILED` | Object storage failure |
| 503 | `UNAVAILABLE` | Database unavailable |

**Shared shapes**

- `UserSummary`: `{id, username, displayName, avatarUrl|null, tier}`.
- `Me`: `{id, username, email, displayName, bio, avatarUrl|null, role, status, emailVerified: boolean, score: {q: string, sigma: string, tier}, createdAt}`. Decimals are strings.
- `Post`: `{id, kind: 'original'|'reshare', author: UserSummary, body, sourceUrl|null, images: [{id, url, width, height}], status, createdAt, editedAt|null, label, underAppeal: boolean, requiresShareConfirmation: boolean, counts: {likes, comments, reshares}, viewer: {liked, reshared}, reshareOf: Post|null (original, one level), authorView?: {detection: {status, band|null}, events: [{kind, value, status}]}, adminView?: {detection: {status, band, pFake, modelName, modelVersion}}}`. `authorView` is present only for the author and admins; `adminView` only for admins.
- `Comment`: `{id, postId, author: UserSummary, body, createdAt}`.
- `LedgerRow`: `{waveNumber, nPos, nNeg, nAdj, r, sigmaUsed, qBefore, delta, qAfter, formulaVersion, finalizedAt}` (decimals as strings).
- `EventItem`: `{id, kind, value, status, waveNumber|null, post: {id, excerpt}, assessment: {verdict, source, createdAt, rationale}|null, reversesEventId|null, appeal: {id, status}|null, createdAt}`.

**Endpoints.** Access: `Pub` no auth; `Auth` signed-in; `Act` signed-in, status `active`, email verified; `Adm` role `admin`.

| Method and path | Access | Request | Success | Notes |
|---|---|---|---|---|
| POST `/auth/register` | Pub | `{username, email, password (10..128), displayName}` | 201 `{user: Me}` + cookie | Creates sigma = `SIGMA_DEFAULT`, queues verification mail |
| POST `/auth/login` | Pub | `{identifier, password}` | 200 `{user: Me}` + cookie | Lockout after 5 failures per identifier+IP in 15 min (429) |
| POST `/auth/logout` | Auth | none | 204 | Deletes session |
| GET `/auth/me` | Auth | none | 200 `{user: Me}` | |
| POST `/auth/verify-email` | Pub | `{token}` | 204 | |
| POST `/auth/resend-verification` | Auth | none | 204 | 3 per hour |
| POST `/auth/forgot-password` | Pub | `{email}` | 204 always | |
| POST `/auth/reset-password` | Pub | `{token, password}` | 204 | Deletes all sessions of the user |
| POST `/auth/change-password` | Auth | `{currentPassword, newPassword}` | 204 | Keeps current session, deletes others |
| GET `/auth/sessions` / DELETE `/auth/sessions/:id` | Auth | | 200 list / 204 | Own sessions only |
| GET `/users/:username` | Pub | | 200 `{id, username, displayName, bio, avatarUrl, tier, q?, counts:{posts, followers, following}, viewer:{following, blocked}, createdAt}` | `q` only when allowed by RUL-023 |
| PATCH `/users/me` | Act | `{displayName?, bio?, avatarMediaId?}` | 200 `{user: Me}` | Other keys rejected |
| DELETE `/users/me` | Auth | `{password}` | 204 | RUL-022 |
| GET `/users/me/export` | Auth | | 200 JSON attachment | Profile, posts, comments, likes, follows, events, ledger, notifications |
| GET `/users/:username/posts` | Pub | cursor | 200 page of `Post` | Excludes deleted and held (held visible to author) |
| GET `/users/:username/followers` and `/following` | Pub | cursor | 200 page of `UserSummary` | |
| POST and DELETE `/users/:username/follow` | Act | | 204 | RUL-028; 409 `ALREADY_EXISTS` on duplicate follow |
| POST and DELETE `/users/:username/block` | Act | | 204 | |
| GET `/users/me/blocks` | Auth | | 200 page of `UserSummary` | |
| GET `/users/suggestions` | Auth | | 200 `{items: UserSummary[]}` (max 10) | RUL-029 |
| GET `/search/posts` | Pub | `q` (>=2), cursor | 200 page of `Post` | RUL-030 |
| GET `/search/users` | Pub | `q` (>=2), cursor | 200 page of `UserSummary` | RUL-030 |
| POST `/media` | Act | multipart `file`, field `kind` (`avatar` or `post_image`) | 201 `{id, url, width, height}` | 5 MB, jpeg/png/webp, re-encoded to webp, max 4096 px longest side (REQ-022) |
| POST `/posts` | Act | `{body (20..500), sourceUrl?, mediaIds? (max 4)}` | 201 `Post` | Queues detection; applies RUL-024 |
| GET `/posts/:id` | Pub | | 200 `Post` | |
| PATCH `/posts/:id` | Act | `{body?, sourceUrl?}` | 200 `Post` | RUL-017 else 409 `EDIT_NOT_ALLOWED` |
| DELETE `/posts/:id` | Act | | 204 | Owner only; soft delete |
| GET `/feed/global` | Pub | cursor | 200 page of `Post` | RUL-031 |
| GET `/feed/following` | Auth | cursor | 200 page of `Post` | Posts and reshares by followed users, plus own |
| POST `/posts/:id/reshare` | Act | `{comment?, acknowledgedWarning?}` | 201 `Post` | RUL-019 |
| DELETE `/posts/:id/reshare` | Act | | 204 | Soft-deletes the caller's reshare of post `:id` |
| POST and DELETE `/posts/:id/like` | Act | | 204 | Idempotent |
| GET `/posts/:id/comments` | Pub | cursor | 200 page of `Comment` (oldest first) | |
| POST `/posts/:id/comments` | Act | `{body (1..300)}` | 201 `Comment` | |
| DELETE `/comments/:id` | Act | | 204 | Author or admin |
| POST `/posts/:id/report` | Act | `{reason, details?}` | 201 `{id}` | RUL-020 |
| GET `/me/score` | Auth | | 200 `{q, sigma, tier, currentWave: {number, openedAt, pending: {nPos, nNeg, nAdj, r, projectedDelta}}, thresholds: {trustedMin, lowMax}}` | `pending` is labelled projected in the UI; it is not Q |
| GET `/me/score/history` | Auth | cursor | 200 page of `LedgerRow` (newest first) | |
| GET `/me/score/history/:waveNumber` | Auth | | 200 `{row: LedgerRow, events: EventItem[]}` | The explanation view |
| GET `/me/events` | Auth | `status?`, cursor | 200 page of `EventItem` | Includes `eligible` and `held` |
| POST `/events/:id/appeal` | Act | `{reason (20..1000)}` | 201 `{id, status}` | RUL-016 else 409 `APPEAL_NOT_ALLOWED` |
| GET `/me/appeals` | Auth | cursor | 200 page of `{id, status, reason, resolutionNote, createdAt, resolvedAt}` | |
| GET `/users/:username/score` | Pub | | 200 `{tier, q?}` | RUL-023 |
| GET `/waves/current` | Pub | | 200 `{number, openedAt}` | |
| GET `/notifications` | Auth | `unread?`, cursor | 200 page of `{id, type, actor: UserSummary|null, postId|null, payload, createdAt, readAt}` | |
| GET `/notifications/unread-count` | Auth | | 200 `{count}` | |
| POST `/notifications/read` | Auth | `{ids?: uuid[]}` | 204 | Omit `ids` to mark all |
| GET `/notifications/stream` | Auth | | SSE | Event name `notification`, data = notification JSON; comment heartbeat every 25 s |
| GET `/messages/conversations` | Auth | cursor | 200 page of `{user: UserSummary, lastMessage, unreadCount}` | |
| GET `/messages/with/:username` | Auth | cursor | 200 page of `{id, senderId, body, createdAt, readAt}` (newest first) | |
| POST `/messages/with/:username` | Act | `{body (1..1000)}` | 201 message | RUL-028 |
| POST `/messages/with/:username/read` | Auth | | 204 | |
| GET `/admin/queue` | Adm | cursor | 200 page of `{post: Post, priority, openReports, reshares, reasons: string[]}` | RUL-013 |
| GET `/admin/posts/:id` | Adm | | 200 `{post, author: {id, username, q, sigma, tier}, detections: [...], reports: [...], assessments: [...], events: [...], appeals: [...]}` | |
| POST `/admin/posts/:id/assessments` | Adm | `{verdict, rationale (10..2000), detectionResultId?}` | 201 `{assessment, eventsCreated: {kind, count}[], eventsVoided, reversalsCreated}` | RUL-004, RUL-015, RUL-021 |
| POST `/admin/posts/:id/release` | Adm | | 204 | RUL-024 |
| DELETE `/admin/posts/:id` | Adm | `{reason}` | 204 | Soft delete + audit |
| POST `/admin/posts/:id/redetect` | Adm | | 202 `{detectionId}` | Inserts new queued row |
| POST `/admin/detections/:id/requeue` | Adm | | 202 | Only `failed_permanent`; resets attempts |
| GET `/admin/appeals` | Adm | `status?`, cursor | 200 page | |
| POST `/admin/appeals/:id/resolve` | Adm | `{decision: 'upheld'|'overturned', note (10..1000), newVerdict?: 'real'|'unverifiable', rationale?}` | 200 | `newVerdict` and `rationale` required when overturned |
| GET `/admin/waves` | Adm | cursor | 200 page `{id, number, status, openedAt, finalizedAt, usersScored?, eventsCounted?}` | |
| GET `/admin/waves/:id/ledger` | Adm | cursor | 200 page of `LedgerRow & {user: UserSummary}` | |
| POST `/admin/waves/:id/finalize` | Adm | none | 200 `{alreadyFinalized, wave, usersScored, eventsCounted}` | Idempotent |
| POST `/admin/verify-scores` | Adm | none | 200 `{ok, issues}` | |
| GET `/admin/users` | Adm | `q?`, `status?`, cursor | 200 page `{user, q, sigma, tier, role, status}` | |
| GET `/admin/users/:id` | Adm | | 200 user + score history | |
| POST `/admin/users/:id/suspend` and `/unsuspend` | Adm | `{reason}` | 204 | Audit logged; admins cannot suspend admins |
| GET `/admin/audit` | Adm | `entityType?`, `entityId?`, `actorId?`, cursor | 200 page | |
| GET `/admin/analytics/overview` | Adm | | 200 `{users, posts, waves, openQueue, openAppeals, detectionStatusCounts}` | |
| GET `/admin/analytics/detector` | Adm | | 200 `{countsByBand, failureRate, avgLatencyMs, agreement: {adminFakeVsBandLikelyFake, ...}}` | Agreement = confusion counts between current admin verdicts and bands |
| GET `/admin/analytics/waves` | Adm | | 200 per-wave `{number, usersScored, nPos, nNeg, nAdj, sumDelta}` | |
| GET `/admin/analytics/spread` | Adm | | 200 per wave and tier: reshares of posts that had label `auto_flagged` or `fact_checked_false`, grouped by `author_tier_at_post` | Used for the credibility-policy demonstration (RUL-011) |
| GET `/admin/export/ledger.csv`, `/events.csv`, `/assessments.csv` | Adm | `waveNumber?` | CSV | Header row, UTF-8, RFC 4180 quoting |
| GET `/admin/detector/status` | Adm | | 200 `{health, modelInfo}` | Proxies detector `/healthz` and `/v1/model-info` |
| GET `/healthz` | Pub | | 200 `{status:'ok'}` | Liveness; outside `/api/v1` |
| GET `/readyz` | Pub | | 200 or 503 `{db, migrations, detector}` | Ready when db ok and all migrations applied; detector state reported, not required |
| GET `/metrics` | Bearer `METRICS_TOKEN` | | Prometheus text | |

**Rate limits** (memory store, keyed by user id when signed in, else IP): global 300 per minute per IP; login 10 per minute per IP; register 5 per hour per IP; forgot-password 5 per hour per IP; `POST /posts` 20 per hour; comments 60 per hour; likes 300 per hour; reshares 60 per hour; reports 30 per hour; media 30 per hour; messages 120 per hour; follows 100 per hour; appeals 5 per day; search 60 per minute.

### 1.8 Frontend specification (binding)

**Routes**

| Path | Page | Data and behaviour |
|---|---|---|
| `/` | Home | Tabs Global and Following; composer (signed-in); infinite scroll |
| `/login`, `/register`, `/forgot-password`, `/reset-password`, `/verify-email` | Auth pages | Forms with inline validation matching Zod schemas |
| `/p/:id` | Post detail | Post, comments, composer for comments, report dialog, reshare dialog |
| `/u/:username`, `/u/:username/followers`, `/u/:username/following` | Profile | Header, tier badge, follow/block menu, posts tab |
| `/search` | Search | Tabs Posts and Users, query in URL |
| `/notifications` | Notifications | List, mark read, live updates via SSE |
| `/messages`, `/messages/:username` | Direct messages | Conversation list and thread, live updates via WebSocket |
| `/score` | My score | Current Q, tier, sigma, pending projection, history table, per-wave explanation drawer, events list with appeal button |
| `/appeals` | My appeals | List and statuses |
| `/settings` | Settings | Profile edit, avatar upload, password change, sessions list, blocks list, email verification status, data export, account deletion |
| `/legal/terms`, `/legal/privacy`, `/legal/guidelines` | Static pages | Content authored in TASK-099 |
| `/admin` | Overview | Counts and links |
| `/admin/queue` | Review queue | Sorted by priority |
| `/admin/posts/:id` | Review workspace | Post, model output, reports, history, decision form |
| `/admin/appeals` | Appeals | List and resolve dialog |
| `/admin/waves` | Waves | Current wave, pending event counts, finalize button with confirmation, ledger viewer |
| `/admin/users`, `/admin/users/:id` | Users | Search, suspend, score history |
| `/admin/audit` | Audit log | Filters |
| `/admin/verify` | Verification | Run `verify-scores`, show issues |
| `/admin/analytics` | Analytics | Charts: detector bands, wave totals, spread by tier; CSV export links |

**UI rules**

- **Labels** (copy centralized in `apps/web/src/copy.ts`): `auto_flagged` shows an amber badge "Automated check: may be misleading (not yet verified)"; `fact_checked_false` shows a red badge "Fact-check: False"; `fact_checked_true` shows a green badge "Fact-check: Verified"; `unverifiable` shows a grey badge "Could not be verified"; `under_appeal` adds the text "Under appeal". `none` shows nothing.
- **Tier badges:** `trusted` "Trusted contributor", `low` "Low credibility (recent verified misinformation)", `neutral` no badge.
- **Author-only detection text:** queued or running "Automated check pending"; ok and `likely_real` "Automated check: no concerns"; ok and `uncertain` "Automated check: inconclusive, sent for review"; ok and `likely_fake` "Automated check flagged this post, sent for review"; failed or `failed_permanent` "Automated check unavailable, sent for review".
- **Reshare confirmation dialog** appears when `requiresShareConfirmation` is true: text "This post was flagged or has been fact-checked as false. Sharing it may reduce your credibility score. Share anyway?" with Cancel and a destructive "Share anyway" button; confirming sends `acknowledgedWarning: true`.
- **Score explanation:** the drawer for wave w shows the formula `Q(w+1) = Q(w) + sigma x R(w)` with the actual numbers, a table of the counted events (kind, value, post excerpt, verdict), and the arithmetic line `R = n+ - n- + adjustments`.
- Every page implements loading skeletons, empty states, and error states with a retry action. Layout works from 360 px width. All interactive elements are keyboard reachable with visible focus; images have alt text; colour is never the only signal (REQ-028). Plain text only is rendered for user content; URLs in text are auto-linked with `rel="noopener noreferrer nofollow ugc"` (REQ-027).
- The SPA keeps no score values in `localStorage`. Auth state comes only from `GET /auth/me`.

### 1.9 Configuration specification (binding)

All variables are read in `apps/api/src/config.ts`, validated with Zod at startup (fail fast, REQ-036). `.env.example` lists every variable with the default shown here.

| Variable | Default | Meaning |
|---|---|---|
| `NODE_ENV` | `development` | `development`, `test`, `production` |
| `PORT` | `3000` | HTTP port |
| `APP_ORIGIN` | `http://localhost:5173` | Exact origin used for the Origin check and email links |
| `TRUST_PROXY` | `1` | Express trust proxy hop count |
| `LOG_LEVEL` | `info` | pino level |
| `DATABASE_URL` | none (required) | App connection string |
| `DATABASE_URL_DIRECT` | value of `DATABASE_URL` | Direct connection used only by migrations |
| `DATABASE_POOL_MAX` | `10` | |
| `SESSION_COOKIE_NAME` | `sid` | |
| `SESSION_TTL_DAYS` | `30` | Absolute lifetime |
| `COOKIE_SECURE` | `true` in production, else `false` | |
| `DETECTOR_URL` | none (required) | Base URL of detector |
| `DETECTOR_API_KEY` | none (required) | Shared secret |
| `DETECTOR_TIMEOUT_MS` | `15000` | |
| `DETECTOR_WARMUP_TIMEOUT_MS` | `90000` | |
| `DETECTOR_MAX_ATTEMPTS` | `3` | |
| `DETECTOR_BACKOFF_SECONDS` | `30,120,600` | |
| `DETECTOR_POLL_INTERVAL_MS` | `2000` | |
| `FAKE_THRESHOLD_HIGH` | `0.65` until TASK-036 writes the evaluated value | |
| `REAL_THRESHOLD_LOW` | `0.35` until TASK-036 writes the evaluated value | |
| `SIGMA_DEFAULT` | `0.500` | |
| `FORMULA_VERSION` | `paper-eq2-v1` | |
| `WAVE_AUTO_FINALIZE_INTERVAL_HOURS` | `0` | 0 disables the scheduler |
| `AUTO_REAL_ENABLED` | `true` | |
| `AUTO_REAL_DELAY_MINUTES` | `60` | |
| `RESHARE_PENALTY_ENABLED` | `true` | |
| `MAX_RESPONSIBLE_POST_EVENTS_PER_WAVE` | `5` | |
| `MAX_VALID_REPORT_EVENTS_PER_WAVE` | `5` | |
| `APPEAL_WINDOW_DAYS` | `14` | |
| `EDIT_WINDOW_MINUTES` | `15` | |
| `Q_TRUSTED_MIN` | `3.000` | |
| `Q_LOW_MAX` | `-1.500` | |
| `HOLD_LOW_TIER_POSTS` | `false` | |
| `PUBLIC_SCORE_VISIBILITY` | `tier_only` | `tier_only` or `full` |
| `REQUIRE_EMAIL_VERIFICATION` | `true` | |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_BASE_URL`, `S3_FORCE_PATH_STYLE` | required (`S3_FORCE_PATH_STYLE=true` for MinIO) | |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`, `EMAIL_FROM` | required | Mailpit locally: host `mailpit`, port `1025`, no auth |
| `SENTRY_DSN` | empty | Disabled when empty |
| `METRICS_TOKEN` | none (required in production) | |

Detector service variables: `DETECTOR_API_KEY`, `MODEL_DIR` (default `/app/artifacts`), `PORT` (default `8000`).

### 1.10 Requirement lists

- **REQ-001**: This plan is the only source of truth. If it is silent on a detail, choose the most restrictive and safest interpretation, record it in `docs/DECISIONS.md` with the task id, and continue. Do not ask for clarification and do not invent features.
- **REQ-002**: No mocks. The product and its tests use the real database, real detector, real object store and real SMTP server. The sole permitted test-only component is `tools/fault-server`, used only by the detection failure tests (TASK-052).
- **REQ-003**: All score arithmetic uses `decimal.js` or PostgreSQL `numeric`; no floating point.
- **REQ-004**: Equation 2 exists in exactly one function (`applyUpdate`); `finalizeWave` is its only production caller.
- **REQ-005**: `users.sigma` is immutable by database trigger (RUL-010).
- **REQ-006**: `users.q` changes only inside `finalizeWave` (trigger plus `SET LOCAL app.scoring`).
- **REQ-007**: Wave finalization is idempotent and safe under concurrency.
- **REQ-008**: The detector returns probabilities only; labels, bands, thresholds and penalties are decided by the API.
- **REQ-009**: A failed or missing prediction never creates a label, an assessment, or an event.
- **REQ-010**: Every endpoint validates params, query and body with strict Zod schemas from `packages/shared`.
- **REQ-011**: Every error response uses the error envelope of Section 1.7.
- **REQ-012**: All list endpoints use cursor pagination.
- **REQ-013**: Every mutation touching more than one table runs in one transaction through `withTransaction`.
- **REQ-014**: Every admin action and every system action that changes scoring state writes `admin_audit_log` in the same transaction.
- **REQ-015**: Responses never contain `password_hash`, other users' email, sigma of other users, `p_fake` outside admin views, or `q` of other users unless `PUBLIC_SCORE_VISIBILITY=full`.
- **REQ-016**: Merged migrations are never edited; changes use new migration files.
- **REQ-017**: Tests run against a real PostgreSQL 16 database; each test file starts from truncated tables (except `waves`, which is re-seeded with open wave 1).
- **REQ-018**: Coverage thresholds: `apps/api/src/scoring` 100 percent lines and branches; `apps/api` overall at least 80 percent lines.
- **REQ-019**: `tsc --noEmit`, ESLint and Prettier checks pass with zero warnings on every commit; Python code passes `ruff` and `mypy` basic checks.
- **REQ-020**: Logs are structured JSON with `requestId`; passwords, tokens, cookies and full emails are never logged.
- **REQ-021**: Domain time decisions use the database clock (`now()`); time-dependent tests change `created_at` values by SQL instead of faking the clock.
- **REQ-022**: Uploaded images are decoded and re-encoded with `sharp` to WebP (quality 82), metadata stripped, longest side capped at 4096 px; the original bytes are never stored.
- **REQ-023**: Passwords are 10 to 128 characters; no other composition rules.
- **REQ-024**: Session cookie attributes: `HttpOnly`, `Secure` (production), `SameSite=Lax`, `Path=/`, `Max-Age` equal to the TTL.
- **REQ-025**: Every non-GET, non-HEAD request must carry an `Origin` header equal to `APP_ORIGIN`, otherwise 403 `FORBIDDEN`.
- **REQ-026**: Text inputs are trimmed, NFC-normalized, and rejected if they contain control characters other than newline.
- **REQ-027**: User content is rendered as plain text; links are auto-linked only for `http` and `https`.
- **REQ-028**: WCAG 2.1 AA target; the E2E suite fails on any axe violation of impact `serious` or `critical`.
- **REQ-029**: UI is usable at 360 px width and up.
- **REQ-030**: The detector rejects requests without the correct `X-Detector-Key` with 401.
- **REQ-031**: Training is reproducible: fixed seeds, pinned `requirements-train.txt`, dataset SHA-256 recorded in artifact metadata.
- **REQ-032**: Model selection and threshold choice use the validation split only; the test split is evaluated once per model for the final report.
- **REQ-033**: Deliverable documents exist as listed in TASK-123 through TASK-133.
- **REQ-034**: An OpenAPI 3.1 document is generated from the Zod schemas and committed at `docs/openapi.yaml`; CI fails if it is stale.
- **REQ-035**: CI runs lint, typecheck, unit tests, integration tests against real service containers (PostgreSQL, MinIO, Mailpit, detector), build, and dependency audits.
- **REQ-036**: Invalid or missing configuration stops the process at startup with a readable error.
- **REQ-037**: On SIGTERM the API stops background loops, closes SSE and WebSocket connections, drains HTTP, closes the pool, and exits within 20 seconds.
- **REQ-038**: PostgreSQL `statement_timeout` is 10 seconds for the app role connection setting.
- **REQ-039**: Each background loop acquires a transaction-level advisory lock (`pg_try_advisory_xact_lock`) per iteration so concurrent instances never run the same iteration.
- **REQ-040**: An `emailOutbox` loop sends queued mail every 10 seconds; failures retry after 1 minute, 5 minutes and 30 minutes, then become `failed_permanent`.
- **REQ-041**: SSE events carry `id` equal to the notification id, `event: notification`, `data:` JSON of the notification shape.
- **REQ-042**: The WebSocket upgrade authenticates with the session cookie and the Origin check; unauthenticated upgrades are rejected with 401.
- **REQ-043**: The E2E suite covers the flows listed in TASK-109.
- **REQ-044**: Every domain notification is inserted in the same transaction as its cause.
- **REQ-045**: Database backup uses `pg_dump` via `scripts/backup.sh`; a restore is rehearsed once and documented (TASK-106).
- **REQ-046**: `scripts/demo-scenario.ts` drives the real HTTP API against real services to build the demonstration data; it uses no direct score writes.
- **REQ-047**: Tier is always derived from current `q`; only `posts.author_tier_at_post` stores a snapshot.
- **REQ-048**: A paper-to-code mapping document lists each equation, proposition and edge case with its implementing function and test (TASK-126).
- **SEC-001**: Passwords hashed with argon2id (memoryCost 19456 KiB, timeCost 2, parallelism 1).
- **SEC-002**: Session tokens are 32 random bytes encoded base64url; only the SHA-256 hash is stored.
- **SEC-003**: Login lockout after 5 failed attempts per identifier+IP within 15 minutes returns 429; the error message does not reveal whether the account exists.
- **SEC-004**: CSRF defence is `SameSite=Lax` plus the Origin check (REQ-025).
- **SEC-005**: `helmet` with CSP: `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: <S3_PUBLIC_BASE_URL origin>; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`; HSTS in production.
- **SEC-006**: Rate limits of Section 1.7 are enforced and covered by tests.
- **SEC-007**: `source_url` is stored and displayed only; the server never fetches it.
- **SEC-008**: Uploads are validated by decoding, not by trusting extension or declared MIME.
- **SEC-009**: Forgot-password always returns 204; verification and reset tokens are single-use, 32 random bytes, hashed at rest, expiring after 24 hours (verify) and 1 hour (reset).
- **SEC-010**: Role and status checks are enforced server-side on every request; the client role is never trusted.
- **SEC-011**: Secrets exist only in environment variables; `.env` is git-ignored; CI uses repository secrets.
- **SEC-012**: CI runs `npm audit --audit-level=high` and `pip-audit`; failures block merge.
- **SEC-013**: Password reset and password change invalidate other sessions.
- **SEC-014**: Account deletion removes PII as defined in RUL-022.
- **CON-001**: No ORM. SQL is written by hand in repository files.
- **CON-002**: No Redis, Kafka, Kubernetes, or additional message brokers.
- **CON-003**: The API runs as one instance.
- **CON-004**: Feeds are chronological only (RUL-031).
- **CON-005**: The detector analyses text only; images are not analysed.
- **CON-006**: Supported language is English.
- **CON-007**: PostgreSQL 16 or newer.
- **CON-008**: Free-tier provider limits (sleep, memory, storage) must be re-verified at deploy time and recorded in `docs/DEPLOYMENT.md`.
- **CON-009**: The detector is trained on LIAR and is in-domain only for short political statements; this is displayed in the model card and the admin detector page.
- **CON-010**: The paper's future-work items (decay, clamping, nonlinear scaling, adaptive sigma, topic-specific reputation, Q-to-behaviour functions) are not implemented in the scoring engine.
- **GUD-001**: Each backend module under `apps/api/src/modules/<name>/` has `routes.ts`, `service.ts`, `repo.ts` and `index.ts`.
- **GUD-002**: Routes contain no business logic; services contain rules; repositories contain SQL only.
- **GUD-003**: SQL is parameterized; string concatenation into SQL is forbidden except for fixed identifiers.
- **GUD-004**: One commit per task with message `TASK-nnn: <summary>`.
- **GUD-005**: Every task ships with its tests; a task is not complete until its tests pass in CI.
- **GUD-006**: No `TODO`, `FIXME`, commented-out code, or placeholder implementations remain after a task.
- **GUD-007**: UI strings live in `apps/web/src/copy.ts`.
- **GUD-008**: Environment-specific behaviour is expressed only through configuration values, never through `if (NODE_ENV)` branches that change domain logic.
- **PAT-001**: Repository pattern for all SQL.
- **PAT-002**: `withTransaction(fn)` helper that begins, commits, rolls back, and releases the client.
- **PAT-003**: Transactional outbox for email.
- **PAT-004**: Append-only records with supersede links instead of updates (assessments, events, ledger, audit).
- **PAT-005**: Idempotency through unique constraints and `ON CONFLICT` handling, never through in-memory flags.
- **PAT-006**: Opaque keyset cursors for pagination.

## 2. Implementation Steps

Execution rules: complete tasks in numeric order within a phase; a phase may start only when the phases it depends on are complete (Section 4). Each task ends with its tests passing and one commit (GUD-004, GUD-005). Mark `Completed` with a check mark and the date when done.

### Implementation Phase 1: Foundation and tooling

- GOAL-001: A runnable monorepo with local infrastructure (PostgreSQL, MinIO, Mailpit), CI, and an API and web skeleton.

| Task | Description | Completed | Date |
|---|---|---|---|
| TASK-001 | Initialize git. Create root `package.json` (private, workspaces `apps/*`, `packages/*`, `tools/*`), `.nvmrc`, `.gitignore` (node_modules, dist, coverage, `.env`, `__pycache__`, `services/detector/data/`), `.editorconfig`, `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`, ES2022), ESLint flat config with typescript-eslint, Prettier config. Root scripts: `lint`, `typecheck`, `test`, `build`, `db:migrate`, `db:migrate:test`. | | |
| TASK-002 | Create `packages/shared` (`@app/shared`): `src/enums.ts` exporting const arrays and Zod enums for every enum in Section 1.4 (roles, statuses, event kinds, verdicts, sources, bands, labels, tiers, report reasons, notification types, appeal statuses, detection statuses) and `src/index.ts`. Build with `tsc` to `dist`. | | |
| TASK-003 | Create `docker-compose.yml` with `postgres` (postgres:16, volume, healthcheck, databases `app` and `app_test` via `scripts/init-test-db.sql`), `minio` plus an init container that creates bucket `app-media` with anonymous download enabled, and `mailpit` (SMTP 1025, UI 8025). Verify `docker compose up -d` reports all services healthy. | | |
| TASK-004 | Create `.env.example` listing every variable in Section 1.9 with its default and a one-line comment; local values for MinIO (`S3_ENDPOINT=http://localhost:9000`, `S3_FORCE_PATH_STYLE=true`) and Mailpit (`SMTP_HOST=localhost`, `SMTP_PORT=1025`). | | |
| TASK-005 | Create `apps/api` skeleton: `src/config.ts` (Zod-validated, REQ-036), `src/logger.ts` (pino with redaction of `authorization`, `cookie`, `password`, `token`), `src/app.ts` (app factory: request id, pino-http, JSON body limit 100 kb, error handler producing the envelope, 404 handler), `src/index.ts` (listen, graceful shutdown per REQ-037), `src/modules/health/routes.ts` (`GET /healthz`). Tests: `/healthz` returns 200; unknown route returns envelope `NOT_FOUND`; invalid config exits with a readable error. | | |
| TASK-006 | Create `apps/web` (Vite, React, TypeScript, Tailwind, React Router, TanStack Query): `src/main.tsx`, `src/App.tsx`, `src/copy.ts`, `src/api/client.ts` (fetch wrapper with `credentials: 'include'`, JSON handling, error envelope parsed into an `ApiError` class). Vite dev proxy: `/api` and `/healthz` to `http://localhost:3000`, `/ws` as WebSocket proxy. Test: Vitest renders `App`. | | |
| TASK-007 | Create `.github/workflows/ci.yml` with jobs `lint-typecheck`, `api-tests` (service containers postgres:16, minio, mailpit), `web-tests`, `detector-tests` (placeholder step list completed in TASK-035), `audit` (`npm audit --audit-level=high`, `pip-audit`). Later tasks append steps. | | |
| TASK-008 | Create test infrastructure in `apps/api/test/setup/`: Vitest config (`pool: 'forks'`, `fileParallelism: false`), `globalSetup.ts` running migrations on `app_test`, `db.ts` with `truncateAll()` (TRUNCATE every table with CASCADE, then insert open wave 1), `factories.ts` that create users, posts and events through the real service layer or SQL. Test: after `truncateAll()` exactly one wave exists and it is open with number 1. | | |
| TASK-009 | Create `docs/DECISIONS.md` (table: id, task, decision, reason) and root `README.md` skeleton (purpose, prerequisites, `docker compose up -d`, `npm ci`, migrate, run). | | |

### Implementation Phase 2: Database

- GOAL-002: The schema of Section 1.4 exists exactly, with all invariants enforced by the database and proven by tests.

| Task | Description | Completed | Date |
|---|---|---|---|
| TASK-010 | Configure `node-pg-migrate` (SQL migrations in `apps/api/src/db/migrations/`, connection from `DATABASE_URL_DIRECT`). Implement `src/db/pool.ts` (pg Pool, `max = DATABASE_POOL_MAX`, `statement_timeout` 10 s, `application_name`) and `src/db/tx.ts` (`withTransaction(fn)` per PAT-002). Tests: transaction commits on success and rolls back on throw; the client is released in both cases. | | |
| TASK-011 | Write `0001_core_identity.sql` containing exactly the `0001` DDL of Section 1.4. | | |
| TASK-012 | Write `0002_posts_detection.sql` containing exactly the `0002` DDL. | | |
| TASK-013 | Write `0003_governance_scoring.sql` containing exactly the `0003` DDL. | | |
| TASK-014 | Write `0004_social.sql` containing exactly the `0004` DDL. | | |
| TASK-015 | Write `0005_search_and_views.sql` containing exactly the `0005` DDL. Run all migrations on `app` and `app_test` and confirm a clean second run applies nothing. | | |
| TASK-016 | Implement `scripts/create-user.ts` (arguments `--username --email --password --display-name [--sigma 0..1] [--admin]`, sets `email_verified_at = now()`, hashes with argon2id per SEC-001) and `scripts/create-admin.ts` (reads `ADMIN_USERNAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, optional `ADMIN_SIGMA`, defaults sigma to `SIGMA_DEFAULT`). Both reuse one `createUser` function in `apps/api/src/modules/users/service.ts`. Tests: created admin can be loaded and has the requested sigma; sigma outside [0,1] is rejected. | | |
| TASK-017 | Write `apps/api/test/db/constraints.test.ts` proving each invariant with a real database: sigma update fails; q update fails without `app.scoring` and succeeds inside a transaction with `SET LOCAL app.scoring = 'on'`; a second open wave fails; ledger rows violating the three CHECKs fail; ledger insert without `app.scoring` fails; ledger update and delete fail; counted event update and any event delete fail; assessments reject every update except `is_current` true to false; a second current assessment for a post fails; audit log update and delete fail; duplicate `(assessment_id, user_id, kind)` event fails; a reshare of a reshare fails; a second non-deleted reshare by the same user fails; self-follow fails; an original post body under 20 characters fails. | | |
| TASK-018 | Write `apps/api/test/db/enum-parity.test.ts` that parses the CHECK lists from the migration SQL text and asserts they equal the arrays exported by `packages/shared/src/enums.ts` for each enum. | | |
| TASK-019 | Implement `src/db/cursor.ts` (`encodeCursor(createdAt, id)`, `decodeCursor`, rejects malformed cursors with `VALIDATION_ERROR`) and `src/db/errors.ts` (maps pg error codes 23505 to `CONFLICT`, 23503 to `CONFLICT`, 23514 to `VALIDATION_ERROR`, 57014 to `UNAVAILABLE`). Unit tests for round trip and malformed input. | | |

### Implementation Phase 3: Scoring engine

- GOAL-003: The paper's equation is implemented once, applied by an idempotent finalization transaction, verified by invariants, and proven by tests.

| Task | Description | Completed | Date |
|---|---|---|---|
| TASK-020 | Implement `apps/api/src/scoring/pure.ts` (`computeR`, `applyUpdate`, `foldHistory`, `decomposedScore`, `verifyUserHistory` per Section 1.5). Implement unit tests TEST-001 through TEST-012 in `apps/api/test/scoring/pure.test.ts`. | | |
| TASK-021 | Implement `apps/api/src/scoring/events.ts`: `createEventsForAssessment(tx, assessment)` and `createReshareEventIfNeeded(tx, reshare)` implementing RUL-004, RUL-005, RUL-007 (open wave locked `FOR SHARE`), with caps recorded as `voided` events (`cap_exceeded`). Reports touched are set to `resolved`. | | |
| TASK-022 | Implement `apps/api/src/scoring/finalizeWave.ts` exactly as the nine steps in Section 1.5, returning `{alreadyFinalized, wave, usersScored, eventsCounted}`. | | |
| TASK-023 | Implement `apps/api/src/scoring/verify.ts` (`verifyScores()` implementing I1 to I6) and `scripts/verify-scores.ts` (prints issues, exit code 1 on any issue). | | |
| TASK-024 | Implement `apps/api/src/scoring/corrections.ts`: `supersedeAssessment(tx, oldAssessment, newAssessmentInput)` implementing RUL-015 (set `is_current = false`, insert successor, void eligible and held events, insert reversals for counted events, then call `createEventsForAssessment`). | | |
| TASK-025 | Implement `apps/api/src/jobs/waveScheduler.ts`: every 60 s, under `pg_try_advisory_xact_lock`, if `WAVE_AUTO_FINALIZE_INTERVAL_HOURS > 0` and the open wave is older than the interval, call `finalizeWave` with actor `{kind:'system'}`. Register the loop in `src/jobs/index.ts` (start and stop functions used by REQ-037). | | |
| TASK-026 | Integration tests `apps/api/test/scoring/finalize.test.ts`: TEST-013 through TEST-020 (all numerical cases through the real database, idempotent double finalize, 10 parallel finalize calls yield one ledger row per user, bystander users get `r = 0` rows, a user created after the wave started is included, persistence after closing and reopening the pool, sigma snapshot equals user sigma, `q` equals `sigma * sum(r)`). | | |
| TASK-027 | Integration tests `apps/api/test/scoring/corrections.test.ts`: TEST-021 through TEST-026 (reversal after counted event, void before finalization, old rows byte-identical after correction, verifier passes after corrections, verifier detects tampering done by disabling the relevant trigger as the database owner and editing a ledger row, event cascade for resharers and reporters). | | |

### Implementation Phase 4: Detector (real model)

- GOAL-004: A trained, evaluated, containerized detector service that implements the contract of Section 1.6.

| Task | Description | Completed | Date |
|---|---|---|---|
| TASK-028 | Scaffold `services/detector`: `pyproject.toml` (ruff, mypy), `requirements.txt` (fastapi, uvicorn, pydantic, scikit-learn, joblib, numpy), `requirements-train.txt` (adds datasets, pandas, matplotlib, torch, transformers, accelerate, pytest, httpx), generate and commit `requirements.lock` files with exact versions. Implement `app/preprocess.py` (`preprocess(text)` per Section 1.6) and `tests/test_preprocess.py` (URL replaced by `<url>`, mention by `<user>`, whitespace collapsed, NFKC applied, idempotent). | | |
| TASK-029 | Implement `training/download_data.py`: load LIAR (`ucsbnlp/liar`), read label names from the dataset features, fail unless the six expected names are present, map to binary, write `data/liar_train.parquet`, `data/liar_val.parquet`, `data/liar_test.parquet`, compute SHA-256 of each. Create `docs/DATASETS.md` recording dataset name, URL, the license text exactly as shown on the dataset card (if the card states none, write "no license stated on the dataset card" and note academic, non-commercial use), the citation (Wang, 2017, "Liar, Liar Pants on Fire", ACL), label mapping, split sizes and hashes. | | |
| TASK-030 | Implement `training/train_baseline.py` per the Section 1.6 configuration: preprocess, fit for each C, pick best validation macro-F1, save `artifacts/baseline/model.joblib`, `artifacts/baseline/metadata.json` and `reports/val_preds_baseline.csv` (columns `statement,label,p_fake`) and `reports/test_preds_baseline.csv` (generated but not inspected until TASK-032). | | |
| TASK-031 | Implement `training/train_transformer.py` per the Section 1.6 configuration: fine-tune `distilroberta-base` (record its license from its model card in `MODEL_CARD.md`), use GPU if available else CPU, save `artifacts/transformer/` (tokenizer and weights), `metadata.json`, `reports/val_preds_transformer.csv` and `reports/test_preds_transformer.csv`. | | |
| TASK-032 | Implement `training/evaluate.py` and run it once for both models on the test split: produce `reports/detector_eval.json`, `reports/detector_eval.md`, confusion matrix and reliability PNGs, ROC-AUC, PR-AUC, ECE, `reports/errors_<model>.csv` (100 misclassified rows). Read 50 rows from each error file and write `reports/error_analysis.md` categorizing them with the five categories of Section 1.6. | | |
| TASK-033 | Implement `training/select_model.py` applying the selection rule of Section 1.6 (with `DETECTOR_HOST_MEMORY_MB` from `docs/DEPLOYMENT.md`, default 512), copy the winner to the serving location (`artifacts/model.joblib` or `artifacts/transformer/`), write the final `artifacts/metadata.json` (including `model_version` = name plus first 8 chars of artifact SHA-256), and author `services/detector/MODEL_CARD.md` (intended use, data, metrics, selection outcome with numbers, limitations including CON-009 and CON-005). If the transformer is selected, track `artifacts/transformer/` with Git LFS. | | |
| TASK-034 | Implement `app/main.py`, `app/schemas.py`, `app/model.py`, `app/config.py` for the contract of Section 1.6 (auth header check in a dependency, model loaded at startup, `/healthz` 503 until loaded, JSON logs with `request_id`, `latency_ms` measured around inference). Write `services/detector/Dockerfile` (python:3.12-slim, non-root user, copies artifacts, `HEALTHCHECK` on `/healthz`). Add service `detector` to `docker-compose.yml` with `DETECTOR_API_KEY` from `.env`. | | |
| TASK-035 | Write `services/detector/tests/test_api.py` using FastAPI `TestClient` against the real loaded model: response schema and `p_fake` range; same text gives same score; 401 with wrong or missing key; 422 for empty text, text over 2000 chars, missing `request_id`, non-UUID `post_id`; `/healthz` 200 when loaded; `/v1/model-info` fields present. Complete the `detector-tests` CI job (install lock file, ruff, mypy, pytest) and add a CI step that builds the image and calls `/healthz` and `/v1/predict` in a container. | | |
| TASK-036 | Implement `training/select_thresholds.py` per Section 1.6 using the validation predictions of the deployed model; write `artifacts/thresholds.json`, expose it in `/v1/model-info`, then copy `fake_high` and `real_low` into `.env.example` (`FAKE_THRESHOLD_HIGH`, `REAL_THRESHOLD_LOW`) and `docs/DEPLOYMENT.md`. Test: thresholds satisfy `0 < real_low < fake_high < 1`. | | |

### Implementation Phase 5: Backend core

- GOAL-005: Authentication, users, media, notifications core, posts, feeds and score read endpoints, all with real services.

| Task | Description | Completed | Date |
|---|---|---|---|
| TASK-037 | Implement middleware in `apps/api/src/middleware/`: `originCheck.ts` (REQ-025), `security.ts` (helmet with SEC-005 CSP and HSTS), `rateLimit.ts` (factories for every limit in Section 1.7, responses use the error envelope and `Retry-After`), `validate.ts` (Zod for params, query, body; strict; maps to `VALIDATION_ERROR` with `details.fields`), `auth.ts` (`loadSession` reads cookie, hashes token, loads user, slides `last_seen_at`; `requireAuth`, `requireActive` (status active and, when `REQUIRE_EMAIL_VERIFICATION`, verified), `requireAdmin`), `errors.ts` (central error to envelope mapping using `db/errors.ts`). Tests for each middleware with the real app. | | |
| TASK-038 | Implement `modules/auth` (routes, service, repo, Zod schemas in `packages/shared/src/schemas/auth.ts`): register (username regex, lowercased; sigma = `SIGMA_DEFAULT`; creates session; queues verification mail), login (identifier is username or email; generic `INVALID_CREDENTIALS`; lockout SEC-003), logout, me. Cookie per REQ-024, token per SEC-002, session TTL `SESSION_TTL_DAYS`. Tests: TEST-040 through TEST-047. | | |
| TASK-039 | Implement `modules/email` (`enqueueEmail(tx, ...)`, nodemailer transport, outbox loop REQ-040 registered in `jobs/index.ts`) and the token flows in `modules/auth`: verify-email, resend-verification, forgot-password, reset-password, change-password, sessions list and delete, per SEC-009 and SEC-013. Tests read the real captured mail from Mailpit (`GET http://localhost:8025/api/v1/messages`) and complete flows end to end, including expired and reused tokens and that unknown emails still return 204 with no mail. | | |
| TASK-040 | Implement `modules/users`: `GET /users/:username`, `PATCH /users/me` (strict schema; `avatarMediaId` must be owned by the caller and have kind `avatar`), counts and viewer flags, tier and `q` visibility per RUL-023. Tests: forbidden fields (`sigma`, `q`, `role`, `status`, `email`) are rejected with 400; another user's `q` hidden under `tier_only`. | | |
| TASK-041 | Implement `modules/media` and `src/storage/s3.ts` (AWS SDK v3 `PutObjectCommand`, `DeleteObjectCommand`; key `media/<yyyy>/<mm>/<uuid>.webp`): `POST /media` using multer memory storage (5 MB limit), `sharp` decode and WebP re-encode (REQ-022), reject undecodable files (415) and oversize (413). Add `jobs/mediaCleanup.ts` (hourly: delete media rows older than 24 h not referenced by `post_media` or `users.avatar_media_id`, and their S3 objects). Tests against real MinIO: PNG upload is stored as WebP and fetchable at its public URL; GIF rejected; truncated JPEG rejected; EXIF stripped; orphan cleanup deletes object. | | |
| TASK-042 | Implement `modules/notifications` core: `createNotification(tx, ...)` (inserts, registers an after-commit hook), `src/realtime/bus.ts` (in-process pub/sub), `src/realtime/sse.ts` (stream per user, `id`, `event: notification`, heartbeat comment every 25 s, cleans up on close), routes `GET /notifications`, `/notifications/unread-count`, `POST /notifications/read`, `GET /notifications/stream`. Tests: notification appears in the list and on a real SSE connection after commit and not after rollback. | | |
| TASK-043 | Implement `modules/posts`: create (validate body and `mediaIds` ownership and unused state, set `author_tier_at_post`, apply RUL-024 hold, insert post, revision 1, `post_media`, and a `queued` detection row in one transaction), get, edit (RUL-017, new revision and new detection row), delete (RUL-018), user posts. Implement `serializePost(viewer, postRows)` using `post_public_status_v`, `post_latest_detection_v`, counts, viewer flags, `authorView` and `adminView` visibility (RUL-023, REQ-015). Tests: validation limits, ownership, edit window and edit-after-assessment rejection, held-post visibility, author sees detection text and public does not. | | |
| TASK-044 | Implement `modules/feed`: `GET /feed/global` and `GET /feed/following` with keyset pagination, excluding deleted and held posts (held visible to author in profile only) and applying block filtering both directions (RUL-028). Tests: ordering stable across pages with identical timestamps, block filtering, following feed includes own posts and reshares by followed users. | | |
| TASK-045 | Implement `modules/score` routes: `GET /me/score` (including `pending` aggregate over eligible events of the open wave and `projectedDelta = sigma * r`), `/me/score/history`, `/me/score/history/:waveNumber` (row plus `EventItem[]` with joins), `/me/events`, `/users/:username/score`, `/waves/current`. Tests with data created through `finalizeWave`. | | |
| TASK-046 | Implement `DELETE /users/me` (RUL-022, SEC-014, requires password) and `GET /users/me/export` (JSON attachment with profile, posts, comments, likes, follows, events, ledger, notifications). Tests: after deletion login fails, PII is replaced, ledger rows remain, `verifyScores` still passes. | | |
| TASK-047 | Write integration tests `apps/api/test/api/authz-matrix.test.ts` covering every endpoint of Phase 5 for: unauthenticated, unverified user, suspended user, normal user, other user, admin. Wire into CI `api-tests`. | | |

### Implementation Phase 6: Detection integration

- GOAL-006: Posts are scored by the real detector asynchronously, failures are handled safely, and nothing derived from a prediction can penalize a user.

| Task | Description | Completed | Date |
|---|---|---|---|
| TASK-048 | Implement `src/detection/client.ts` (undici or fetch with `AbortController`, header `X-Detector-Key`, Zod response validation, error classification per Section 1.6) and `src/detection/bands.ts` (`toBand(pFake)` per RUL-027). Unit tests for every error code and band boundaries (`p = FAKE_THRESHOLD_HIGH` is `likely_fake`; `p = REAL_THRESHOLD_LOW` is `likely_real`). | | |
| TASK-049 | Implement `src/detection/worker.ts` per RUL-026: claim due rows with `FOR UPDATE SKIP LOCKED`, warm-up logic, success and failure transitions, stale `running` reset, loop interval `DETECTOR_POLL_INTERVAL_MS`, registered in `jobs/index.ts` with advisory lock per claim batch (REQ-039). | | |
| TASK-050 | Implement post-detection effects in `src/detection/effects.ts`, called inside the success transaction: when band is `likely_fake` or `uncertain` and the post has no current assessment, nothing is written to the queue (the view derives it); when band is `likely_fake` create a `post_flagged` notification for the author. Assert in code and tests that this path never inserts into `assessments` or `reputation_events` (REQ-009). | | |
| TASK-051 | Implement admin detection endpoints `POST /admin/posts/:id/redetect`, `POST /admin/detections/:id/requeue`, `GET /admin/detector/status`, and `GET /readyz` (database, migrations applied equals number of files, detector health reported). Audit-log redetect and requeue. | | |
| TASK-052 | Implement `tools/fault-server/server.ts`: a real HTTP server with switchable behaviours selected by a path prefix (`/slow`, `/http500`, `/http401`, `/malformed-json`, `/p-fake-out-of-range`, `/wrong-request-id`, `/refuse` (closes socket)). It is used only by tests, lives outside `apps/api/src`, and is never started in any non-test environment. Write `apps/api/test/detection/failures.test.ts` running the real worker against each fault: row ends `failed` with the right `error_code`, attempts and `next_attempt_at` follow `DETECTOR_BACKOFF_SECONDS`, the row becomes `failed_permanent` after `DETECTOR_MAX_ATTEMPTS`, the post stays published, and zero assessments and zero events exist. | | |
| TASK-053 | Write `apps/api/test/detection/real-detector.test.ts` against the real detector container: a created post receives an `ok` result with model name and version recorded; bands follow thresholds; restarting the detector container mid-queue results in successful retry; editing a post creates a second row for the new revision and the label derives from the latest revision only. Add the detector container to the CI `api-tests` job. | | |

### Implementation Phase 7: Governance (reports, assessments, appeals, admin)

- GOAL-007: Human-reviewed assessments are the only route from a post to a reputation event, with full audit, appeals and corrections.

| Task | Description | Completed | Date |
|---|---|---|---|
| TASK-054 | Implement `modules/governance/reports`: `POST /posts/:id/report` per RUL-020 (own post rejected with 403 `FORBIDDEN`, duplicate with 409 `ALREADY_EXISTS`, deleted post 404). Tests for each rejection and for the post entering the review queue after the first report. | | |
| TASK-055 | Implement `modules/governance/assessments` and `POST /admin/posts/:id/assessments`: one transaction that locks the post row, enforces RUL-021, rejects a verdict equal to the current one with 409 `ALREADY_EXISTS`, validates `detectionResultId` belongs to the post, calls `supersedeAssessment` when a current assessment exists else inserts the first one, calls `createEventsForAssessment`, resolves reports, writes the audit row (`assessment.create` with before and after), and creates notifications (`assessment_decided` for author and penalized resharers, `report_resolved` for reporters). Returns the summary of Section 1.7. | | |
| TASK-056 | Implement `src/jobs/autoReal.ts` per RUL-014 (every 60 s, advisory lock, batch of at most 100 posts per run, each assessment created through the same service function with `source = 'auto_real'`, audit actor kind `system`). Tests: each condition of RUL-014 individually blocks the assessment; `AUTO_REAL_ENABLED=false` creates none; resulting event respects the cap. | | |
| TASK-057 | Implement `modules/governance/appeals`: `POST /events/:id/appeal` (RUL-016: negative non-voided event owned by caller, within `APPEAL_WINDOW_DAYS`, one per event; eligible event becomes `held` with `wave_id = NULL`; counted event unchanged), `GET /me/appeals`; `appeal_opened` notification to every admin. Tests: window expiry, other user's event, positive event, duplicate appeal, held event excluded from `finalizeWave`. | | |
| TASK-058 | Implement admin appeal endpoints (`GET /admin/appeals`, `POST /admin/appeals/:id/resolve`): `upheld` releases a held event to the open wave (RUL-008); `overturned` requires `newVerdict` and `rationale`, creates the superseding assessment through `supersedeAssessment`, records `new_assessment_id`; RUL-021 enforced; audit row; `appeal_resolved` notification. Tests: upheld then finalize applies the penalty once; overturned before finalization voids; overturned after finalization yields a reversal that nets to zero in the next wave. | | |
| TASK-059 | Implement the remaining admin endpoints in `modules/admin`: `GET /admin/queue` (reads `review_queue_v`, includes reasons array), `GET /admin/posts/:id`, `POST /admin/posts/:id/release`, `DELETE /admin/posts/:id`, `GET /admin/users`, `GET /admin/users/:id`, `POST /admin/users/:id/suspend` and `/unsuspend` (admins cannot suspend admins; suspending deletes sessions), `GET /admin/audit`, `GET /admin/waves`, `GET /admin/waves/:id/ledger`, `POST /admin/waves/:id/finalize`, `POST /admin/verify-scores`. Every mutating endpoint audit-logs per REQ-014. | | |
| TASK-060 | Write `apps/api/test/governance/rules.test.ts` covering TEST-050 through TEST-066: verdict to events matrix (real, fake, unverifiable), reshare and reporter cascades, retraction before verdict, cap behaviour, queue membership and priority order, admin conflict of interest, uncertain and failed detection never produce events, audit rows exist for each admin action, suspended users blocked, public responses never leak `p_fake`. | | |

### Implementation Phase 8: Social features

- GOAL-008: Likes, comments, follows, blocks, reshares, search and suggestions with real notifications.

| Task | Description | Completed | Date |
|---|---|---|---|
| TASK-061 | Implement `modules/social/likes` and `modules/social/comments` (routes in Section 1.7): idempotent like and unlike, comment create and soft delete (author or admin), notifications `like` and `comment` (not for self-actions), RUL-028 block checks. Tests including counts and block interplay. | | |
| TASK-062 | Implement `modules/social/follows` and `modules/social/blocks`: follow and unfollow, followers and following lists, block and unblock (block deletes follows both ways), `GET /users/me/blocks`, `new_follower` notification. Tests: self-follow rejected, duplicate follow 409, blocked user cannot follow. | | |
| TASK-063 | Implement `modules/social/reshares`: `POST /posts/:id/reshare` (RUL-019 including `CONFIRMATION_REQUIRED`, target must be an original and visible, caller not blocked by the author) and `DELETE /posts/:id/reshare`; call `createReshareEventIfNeeded` in the same transaction when the original's current verdict is `fake` and `RESHARE_PENALTY_ENABLED`; `reshare` notification. Tests: confirmation required for flagged, fact-checked false and low-tier originals; reshare of fake yields an immediate eligible `MISINFO_RESHARE`; retraction before verdict yields none. | | |
| TASK-064 | Implement `modules/search` (RUL-030): `GET /search/posts` and `/search/users` with keyset pagination (post rank order uses `(rank, created_at, id)` cursor). Tests: ranking, minimum length, deleted and held posts excluded, blocked authors hidden. | | |
| TASK-065 | Implement `modules/social/suggestions` (RUL-029) as one SQL query with the fill-in rule. Tests: two-hop candidates ranked by mutual count, exclusions, fallback fill, tier and `q` never influence order. | | |
| TASK-066 | Write `apps/api/test/social/flows.test.ts` covering TEST-070 through TEST-079 (unique constraints surface as 409, counts consistent after like/unlike races, comment deletion permissions, notifications created exactly once per action). | | |

### Implementation Phase 9: Credibility policy (Layer 1 and Layer 2)

- GOAL-009: Labels, tiers, confirmation prompts and optional holds, derived only from detection bands and assessments, never from unreviewed model output beyond a visible label.

| Task | Description | Completed | Date |
|---|---|---|---|
| TASK-067 | Implement `src/scoring/tier.ts` (`tierOf(q: Decimal)` per RUL-011 using `Q_TRUSTED_MIN` and `Q_LOW_MAX`) and use it in every serializer (users, posts, feeds, score). Unit tests for boundaries (`q = Q_TRUSTED_MIN` is trusted; `q = Q_LOW_MAX` is low). | | |
| TASK-068 | Finalize post serialization of `label`, `underAppeal` and `requiresShareConfirmation` (true when label is `auto_flagged` or `fact_checked_false` or author tier is `low`). Tests: label transitions `none` to `auto_flagged` to `fact_checked_false` to `none` after an overturned appeal (verdict `real` by admin gives `fact_checked_true`, verdict `unverifiable` gives `unverifiable`). | | |
| TASK-069 | Implement the hold rule of RUL-024 inside post creation and the admin release path; held posts appear in `review_queue_v`. Tests with `HOLD_LOW_TIER_POSTS` true and false (config injected per test through the config factory, not by branching domain code). | | |
| TASK-070 | Implement `GET /admin/analytics/spread` query: per wave number and `author_tier_at_post`, counts of posts that received label `auto_flagged` or `fact_checked_false` and the number of reshares each received before and after the label time (label time = detection completion for `auto_flagged`, assessment creation for `fact_checked_false`). Tests with constructed real data. | | |

### Implementation Phase 10: Direct messages

- GOAL-010: Real-time one-to-one messaging with block enforcement.

| Task | Description | Completed | Date |
|---|---|---|---|
| TASK-071 | Implement `modules/messages` REST (`GET /messages/conversations`, `GET /messages/with/:username`, `POST /messages/with/:username`, `POST /messages/with/:username/read`) per Section 1.7 with RUL-028 and rate limit. Implement `src/realtime/ws.ts` with `ws`: upgrade authenticated by session cookie plus Origin check (REQ-042), server pushes `{type: 'message.new', message}` after commit via the bus, ping every 25 s, closes on logout. | | |
| TASK-072 | Write `apps/api/test/messages/messages.test.ts` (TEST-080 through TEST-086): send and receive over a real WebSocket client, unread counts, read receipts, blocked users, suspended users, unauthenticated upgrade rejected, wrong Origin rejected. | | |

### Implementation Phase 11: Analytics, exports and API documentation

- GOAL-011: Admin insight, CSV export, and a generated OpenAPI contract.

| Task | Description | Completed | Date |
|---|---|---|---|
| TASK-073 | Implement `GET /admin/analytics/overview`, `/detector` (counts by band, failure rate, average latency, confusion counts between current admin verdicts and bands), `/waves` (per wave totals). Tests against seeded real rows. | | |
| TASK-074 | Implement CSV exports `GET /admin/export/ledger.csv`, `/events.csv`, `/assessments.csv` (streamed with a cursor, RFC 4180 quoting, optional `waveNumber`). Tests parse the CSV and compare to database rows, including values containing commas, quotes and newlines. | | |
| TASK-075 | Generate OpenAPI 3.1 from the Zod schemas with `@asteasolutions/zod-to-openapi` into `docs/openapi.yaml` via `npm run docs:openapi`; CI step regenerates and fails on a diff (REQ-034). | | |
| TASK-076 | Write `apps/api/test/admin/analytics.test.ts` (TEST-090 through TEST-094) for authorization (403 for non-admin), numbers against known data, CSV content, and the spread query. | | |

### Implementation Phase 12: Frontend

- GOAL-012: Every screen of Section 1.8 is implemented against the real API; no screen uses fabricated data, and no component performs score arithmetic. Add `recharts` for charts and `@testing-library/react` with `@testing-library/user-event` for component tests.

| Task | Description | Completed | Date |
|---|---|---|---|
| TASK-077 | Foundation: app shell with responsive navigation (home, search, notifications with unread badge, messages, score, profile menu, admin link for admins), shared components `Button`, `Modal`, `ConfirmDialog`, `Toast`, `Skeleton`, `Avatar`, `Badge`, `EmptyState`, `ErrorState`, `InfiniteList` (keyset pagination with TanStack Query `useInfiniteQuery`), `useMe` hook (`GET /auth/me`), route guards (`RequireAuth`, `RequireAdmin`), all strings in `src/copy.ts` (GUD-007). | | |
| TASK-078 | Auth pages `/login`, `/register`, `/forgot-password`, `/reset-password`, `/verify-email` with validation using the shared Zod schemas, field-level server errors, and a banner for unverified accounts with a "Resend email" action. | | |
| TASK-079 | `PostCard` component: author, body (plain text with safe auto-linking per REQ-027), images, source URL, counts, label badge and `Under appeal` text, tier badge, author-only detection text, reshared original nested one level, action bar. Pure presentational with typed props; label and tier copy from `copy.ts` exactly as in Section 1.8. | | |
| TASK-080 | `Composer` component: textarea with live counter (20 to 500), optional source URL, up to 4 images uploaded through `POST /media` with progress and removal, submit disabled until valid, shows the created post immediately with "Automated check pending". | | |
| TASK-081 | Home page with Global and Following tabs, infinite scroll, new-post composer, and a "Who to follow" side panel using `GET /users/suggestions`. | | |
| TASK-082 | Post detail page `/p/:id` with comments list, comment composer, delete own comment, 404 and blocked states. | | |
| TASK-083 | Interaction components: like toggle (optimistic update with rollback), reshare dialog (comment field, confirmation flow per Section 1.8 on `CONFIRMATION_REQUIRED`), retract reshare, report dialog (reason select and details), edit post (only while `EDIT_NOT_ALLOWED` is not returned; show remaining edit window), delete post confirmation. | | |
| TASK-084 | Profile page `/u/:username` (header, counts, tier badge, follow and block actions, posts tab) and `/u/:username/followers`, `/u/:username/following`. | | |
| TASK-085 | Settings page: profile edit with avatar upload, password change, active sessions with revoke, blocked users with unblock, email verification status, data export download, account deletion with password confirmation. | | |
| TASK-086 | Search page `/search` with tabs Posts and Users, query in the URL, debounce 300 ms, minimum 2 characters. | | |
| TASK-087 | Notifications page with list and mark-all-read, `useNotificationStream` hook (EventSource to `/api/v1/notifications/stream`, reconnect with backoff, polling fallback every 30 s when the stream is down), unread badge updates in real time. | | |
| TASK-088 | Messages pages with conversation list, thread view (newest at the bottom, load older on scroll), composer, WebSocket hook with reconnect, read receipts. | | |
| TASK-089 | Score page `/score`: current Q (large), tier, sigma, a "Pending in the current wave" card (n+, n-, adjustments, R, projected change, labelled "not part of your score until the wave is finalized"), and thresholds explanation. | | |
| TASK-090 | Score history table and per-wave explanation drawer: formula with actual numbers (`Q(w+1) = Q(w) + sigma x R(w)`), table of counted events (kind, value, post excerpt linking to the post, verdict, rationale), arithmetic line `R = n+ - n- + adjustments`. Values come only from `GET /me/score/history` and `/history/:waveNumber`. | | |
| TASK-091 | Events list (pending and counted) with status chips and an "Appeal" button for eligible negative events inside the window (dialog with reason 20 to 1000 chars), and `/appeals` page showing statuses and resolution notes. | | |
| TASK-092 | Admin shell (`/admin` layout with side navigation, guarded by `RequireAdmin`) and overview page from `GET /admin/analytics/overview`. | | |
| TASK-093 | Admin review queue page: table sorted by priority with reasons chips, counts, age, link to workspace; infinite scroll. | | |
| TASK-094 | Admin review workspace `/admin/posts/:id`: post, author score card, detection history with `p_fake` and model version, reports list, assessment history, events and appeals, decision form (verdict select, rationale min 10 chars, optional detection result link) with confirmation summarizing consequences ("will create -1 for author and N resharers, +1 for M reporters"), release and delete actions for held posts, re-run detection button. | | |
| TASK-095 | Admin appeals page: list with filters, detail dialog, resolve form (upheld, or overturned with new verdict and rationale). | | |
| TASK-096 | Admin waves page: current wave with counts of eligible and held events, Finalize button with confirmation dialog stating that this applies Equation 2 once and cannot be undone, previous waves with ledger viewer (paginated, CSV link). | | |
| TASK-097 | Admin users page (search, status filter, suspend and unsuspend with reason, view score history), audit log page with filters, and verification page that runs `POST /admin/verify-scores` and renders the issues table or a success state. | | |
| TASK-098 | Admin analytics page with `recharts`: bands distribution, detector failure rate and latency, per-wave `n+`, `n-`, `n_adj`, and spread by tier chart from `/admin/analytics/spread`; CSV export buttons. | | |
| TASK-099 | Legal pages `/legal/terms`, `/legal/privacy`, `/legal/guidelines` with complete written content: terms (acceptable use, content responsibility), privacy (data collected: email, username, posts, sessions, IP, user agent; retention; deletion process; processors: hosting, database, object storage, email provider), community guidelines (what is reviewed, how labels and scores work, appeals, the fact that automated checks are not verdicts). | | |
| TASK-100 | Global states: error boundary, 404 page, 403 page, offline banner, empty states for every list, skeletons for every query, toast on mutation errors using the envelope `message`. | | |
| TASK-101 | Accessibility and responsiveness pass: landmarks, labels, focus management in dialogs, keyboard operation of every control, colour contrast at least 4.5:1, layouts verified at 360, 768 and 1280 px, `prefers-reduced-motion` respected. | | |
| TASK-102 | Component tests (Vitest and Testing Library) for pure presentational components only: `PostCard` renders each label, tier, author-detection state and under-appeal text exactly per `copy.ts`; score explanation formats decimals as strings without rounding; reshare dialog flow; composer validation. Data fetching is verified only in E2E against the real stack (TASK-109). | | |

### Implementation Phase 13: Security and observability

- GOAL-013: Security controls are enforced and proven; the system is observable.

| Task | Description | Completed | Date |
|---|---|---|---|
| TASK-103 | Write `apps/api/test/security/headers-and-limits.test.ts`: CSP, HSTS (production config), cookie attributes, Origin check on every mutating method, unknown JSON keys rejected on every mutating endpoint (iterate over the OpenAPI document), every rate limit of Section 1.7 returns 429 with `Retry-After`, login lockout, generic login error messages. | | |
| TASK-104 | Add Sentry to API and web (active only with `SENTRY_DSN`; scrub cookies, authorization, request bodies). Add `prom-client` metrics at `/metrics` (Bearer `METRICS_TOKEN`): HTTP duration histogram, detection queue depth gauge, detection latency histogram, detection failures counter by `error_code`, `finalizeWave` duration histogram, active SSE and WebSocket gauges. Tests: metrics endpoint requires the token and exposes the named series. | | |
| TASK-105 | Tests for logging redaction (password, token, cookie never appear in captured logs), graceful shutdown (spawn the built API, open an SSE connection, send SIGTERM, assert exit code 0 within 20 s), and that every loop in `jobs/index.ts` stops on shutdown. | | |
| TASK-106 | Implement `scripts/backup.sh` (`pg_dump --format=custom`, optional `gpg --symmetric` with `BACKUP_PASSPHRASE`) and `scripts/restore.sh` (restore into a named scratch database). Rehearse: back up the local database, restore to scratch, run `scripts/verify-scores.ts` against it, record the procedure and timings in `docs/OPERATIONS.md` (REQ-045). | | |
| TASK-107 | Write `apps/api/test/security/abuse.test.ts` and `docs/SECURITY.md`: IDOR attempts on events, appeals, messages, notifications and drafts of other users all return 404 or 403; mass-assignment attempts fail; SQL injection strings in search and cursor parameters return normal results or 400 and never errors; stored XSS payloads are returned unchanged as text; `source_url` is never fetched (a real local listener receives zero connections within 5 s of creating a post whose `source_url` points at it); oversize and malformed multipart bodies rejected. | | |

### Implementation Phase 14: Test completion

- GOAL-014: End-to-end, concurrency, performance and regression coverage on the real stack.

| Task | Description | Completed | Date |
|---|---|---|---|
| TASK-108 | Set up Playwright in `e2e/`: config with projects for desktop Chromium and mobile viewport; global setup starts docker-compose services (postgres, minio, mailpit, detector), runs migrations, creates the admin with the CLI, builds the web app and starts the API serving it; helpers to read mail from Mailpit and to create verified users through `scripts/create-user.ts`; axe fixture that fails on `serious` or `critical` violations (REQ-028). | | |
| TASK-109 | Implement E2E specs (REQ-043): F01 register, verify email through Mailpit, login, post, see author-only detection text; F02 admin decides `fake` with rationale and a second user's session sees `Fact-check: False`; F03 admin finalizes the wave and the score drawer numbers equal the API values; F04 appeal then admin overturn then reversal appears in the next wave; F05 reshare confirmation dialog; F06 follow, following feed, like, comment, live notification over SSE; F07 live direct message between two browser contexts; F08 image upload and display; F09 forgot and reset password; F10 account deletion; F11 suspended user blocked from posting; F12 restart the API process and log in again to see identical score and history; F13 detector container stopped: post is created, shows "Automated check unavailable", no label and no event, and after the container restarts the check completes; F14 admin verification page reports OK. | | |
| TASK-110 | Implement `scripts/load-test.ts` with `autocannon`: seed 5,000 users and 20,000 posts through the real database layer, then measure feed endpoints at 50 concurrent connections, 20 concurrent post creations, and `finalizeWave` over 5,000 users. Gates: feed p95 under 500 ms; finalization under 30 s on the CI runner. Record numbers and hardware in `docs/PERFORMANCE.md` as measurements. | | |
| TASK-111 | Add `services/detector/tests/test_regression.py` and a golden file `tests/golden_predictions.json` (20 fixed statements and their `p_fake` generated by the packaged model); the test asserts equality within 1e-6 and that `metadata.json` validation macro-F1 is at least the value recorded in `MODEL_CARD.md` minus 0.02. | | |
| TASK-112 | Enforce coverage gates in Vitest config and CI per REQ-018 (scoring 100 percent lines and branches; API 80 percent lines); publish the coverage summary as a CI artifact. | | |

### Implementation Phase 15: Deployment and operations

- GOAL-015: A public HTTPS deployment on real managed services, verified by automated smoke tests.

| Task | Description | Completed | Date |
|---|---|---|---|
| TASK-113 | Add `apps/api/src/static.ts` (serve `apps/api/public` when present: hashed assets with `Cache-Control: public, max-age=31536000, immutable`, `index.html` with `no-cache`, SPA fallback only for GET requests not starting with `/api`, `/ws`, `/healthz`, `/readyz`, `/metrics`). Create root `Dockerfile` (multi-stage: install, build shared, web and api; runtime on Node LTS slim as non-root user; copy `apps/web/dist` to `apps/api/public`; start command `npm run db:migrate && node apps/api/dist/index.js`). Tests: `/` returns the SPA, unknown `/api/...` returns JSON `NOT_FOUND`, cache headers as specified. | | |
| TASK-114 | Create `render.yaml` defining web service `api-web` (Docker, health check path `/readyz`, environment variables from Section 1.9 with secrets marked not synced) and web service `detector` (Docker, root directory `services/detector`, health check `/healthz`). Both in the same region as the database. | | |
| TASK-115 | Create the Neon project (PostgreSQL 16), database `app`, application role; record both pooled (`DATABASE_URL`) and direct (`DATABASE_URL_DIRECT`) connection strings in the host's secret store; verify `pg_trgm` and `pgcrypto` can be created. | | |
| TASK-116 | Create the Cloudflare R2 bucket for media with public read access (custom domain or the provider public URL), an access key limited to that bucket, and set the `S3_*` variables (`S3_FORCE_PATH_STYLE=false`). Create the SMTP provider account, verify the sender address or domain, and set the `SMTP_*` and `EMAIL_FROM` variables. | | |
| TASK-117 | Generate `DETECTOR_API_KEY` and `METRICS_TOKEN` (32 random bytes each, base64url) and set them on the hosts; set `APP_ORIGIN` to the public HTTPS URL, `COOKIE_SECURE=true`, `NODE_ENV=production`, `TRUST_PROXY=1`, and threshold values from TASK-036. | | |
| TASK-118 | Deploy the detector service; confirm `/healthz` is 200, a real `POST /v1/predict` with the key returns a valid response, and a request without the key returns 401; measure and record cold-start time in `docs/DEPLOYMENT.md`. | | |
| TASK-119 | Deploy `api-web`; confirm migrations applied (`/readyz` 200), create the production admin through a one-off command running `scripts/create-admin.ts`, and verify login over HTTPS with the cookie marked Secure. | | |
| TASK-120 | Implement `scripts/smoke-prod.ts` and add it to a manual GitHub workflow `smoke.yml`: health and readiness, login as a pre-created smoke user (created with the CLI), create a post and poll until detection is `ok` within 120 s, read it back from the global feed, like and unlike it, delete it, then as admin fetch the queue and run `verify-scores`; exits non-zero on any failure. | | |
| TASK-121 | Verify current provider limits from their official documentation pages (Render instance memory and sleep behaviour, Neon storage and compute limits, R2 free allowance, SMTP provider sending limits) and record each value, date and URL in `docs/DEPLOYMENT.md` (CON-008). If the detector host memory differs from the 512 MB assumption, set `DETECTOR_HOST_MEMORY_MB` accordingly and re-run TASK-033 and TASK-036, then redeploy. | | |
| TASK-122 | Create `.github/workflows/backup.yml` (weekly schedule and manual trigger) running `scripts/backup.sh` with secrets `DATABASE_URL_DIRECT` and `BACKUP_PASSPHRASE`, uploading the encrypted dump as an artifact with 30-day retention. | | |

### Implementation Phase 16: Documentation and academic deliverables

- GOAL-016: Documentation that lets a reviewer reproduce, understand and evaluate the project, and a demonstration that proves the paper's properties on the real system.

| Task | Description | Completed | Date |
|---|---|---|---|
| TASK-123 | Write `README.md`: overview, architecture summary, prerequisites, local setup (`docker compose up -d`, `npm ci`, migrate, create admin, run), test commands, deployment summary, environment variable reference, links to docs. | | |
| TASK-124 | Write `docs/ARCHITECTURE.md` including the diagrams of Section 1.1 as Mermaid, the post lifecycle sequence diagram (submit, detect, review, event, finalize, display), the wave state diagram, and failure handling table. | | |
| TASK-125 | Write `docs/ER.md` with a Mermaid `erDiagram` generated from the migration files and a description of every table and invariant. | | |
| TASK-126 | Write `docs/PAPER_MAPPING.md`: for each of Equation 1, Equation 2, initialization, fixed sigma, Algorithm 1, Propositions 1 to 3, each edge case, and each governance signal, give the paper statement, implementing file and function, and the TEST ids that verify it; a separate table lists every engineering decision of this plan with RUL ids and marks it as "not from the paper"; a third lists the paper's future-work items as not implemented. | | |
| TASK-127 | Write `docs/DETECTOR.md` summarizing the dataset, models, selection outcome, metrics, figures (embedded from `reports/`), error analysis, thresholds, and a section "Benchmark versus application performance" using `/admin/analytics/detector` numbers from the demo data. | | |
| TASK-128 | Implement `npm run docs:scoring-report` that runs the scoring and governance tests with a JSON reporter and generates `docs/SCORING_TESTS.md` (table of TEST ids, description, expected values, actual result). | | |
| TASK-129 | Implement `scripts/demo-scenario.ts` (REQ-046) for a fresh database with only the admin: create users via the CLI (`alice` sigma 0.8, `bob` sigma 0.8, `carol` sigma 0.4, `dan` sigma 0, `eve` sigma 0.8, `rita` sigma 0.5); for waves 1 to 3 each user posts two statements from a fixed list through the API, waits for real detection, the admin assesses them through the API (alice, carol, dan: real in all three waves; bob: fake in all three; eve: real, fake, real), rita reports one of bob's posts per wave, the admin finalizes each wave; then asserts exact scores (alice 4.8, bob -4.8, carol 2.4, dan 0.0, eve 1.6, rita as computed from her valid reports and sigma 0.5), asserts `q = sigma * sum(r)` for each user, and runs `verify-scores`. Wave 4 is left open for live demonstration. The script fails if the database is not fresh. | | |
| TASK-130 | Write `docs/DEMO.md` (runbook and a ten-minute script: show alice versus bob divergence `2 * 0.8 * 2 * 3 = 9.6`, carol at half of alice, dan unchanged at 0, eve oscillation, live post and review, appeal and reversal, finalization, `verify-scores`, restart persistence) and generate screenshots into `docs/screenshots/` with a Playwright script. | | |
| TASK-131 | Write `docs/REPORT.md` following this outline: problem and paper summary; paper-to-implementation mapping; architecture and schema; scoring implementation and invariants; detector data, models, metrics and error analysis; testing; fairness, ethics and limitations; deployment; future work. | | |
| TASK-132 | Write `docs/LIMITATIONS.md` listing the paper's limitations (no Q-to-behaviour response, policy-dependent reputation, assumes accurate observation, no temporal network evolution), this system's limitations (CON-003, CON-005, CON-006, CON-009, evasion through new accounts, modest detector accuracy, single admin team), and future work (paper's list plus multi-instance realtime, multilingual detector, fact-check database lookup, cross-dataset evaluation). | | |
| TASK-133 | Final acceptance run: from a clean clone run the full CI pipeline, E2E suite, `docs:openapi`, `docs:scoring-report`, deploy, `smoke-prod`, `demo-scenario` on a fresh staging database, and confirm every item of the acceptance checklist in `docs/DEMO.md` (all TEST ids passing, `verify-scores` OK, README steps reproducible by following them exactly). | | |

## 3. Alternatives

- **ALT-001**: MongoDB instead of PostgreSQL. Rejected: the scoring guarantees (once per wave, immutable ledger, fixed sigma, atomic finalization) are enforced most directly by constraints, triggers, row locks and transactions.
- **ALT-002**: An ORM (Prisma or Drizzle). Rejected (CON-001): the triggers, partial unique indexes, `FOR UPDATE` and `FOR SHARE` locks and views are central, and hand-written SQL keeps the agent's output deterministic.
- **ALT-003**: JWT access tokens. Rejected: server-side sessions can be revoked immediately (suspension, password reset) and need no refresh-token logic.
- **ALT-004**: Redis or a message broker for the detection queue. Rejected (CON-002): a PostgreSQL table with `SKIP LOCKED` is sufficient and transactional.
- **ALT-005**: Per-post scoring without waves. Rejected: it would replace the paper's wave-based formulation with an unrelated formula.
- **ALT-006**: Fixed time-window waves only. Rejected as the sole mechanism: they could finalize while posts are unreviewed. Time windows remain available through the optional scheduler (RUL-006).
- **ALT-007**: Automatic penalties from model output. Rejected (RUL-002): predictions can be wrong and penalties affect users.
- **ALT-008**: A mock or stub detector for development. Rejected by the no-mock policy (REQ-002); a real baseline model trains in minutes and runs on CPU.
- **ALT-009**: A pretrained community fake-news model as the primary detector. Rejected: unverifiable provenance and quality; the trained models are evaluated on a known dataset with a recorded split and license.
- **ALT-010**: Separate frontend hosting with cross-origin cookies. Rejected: serving the SPA from the API gives one origin, simple `SameSite=Lax` cookies and no CORS.
- **ALT-011**: Python for the whole backend. Rejected: keeps one language across API and web; the detector stays Python because of the ML stack.
- **ALT-012**: Multi-instance realtime with PostgreSQL `LISTEN/NOTIFY`. Deferred (CON-003): needs non-pooled connections; documented as future work.

## 4. Dependencies

- **DEP-001**: Docker and docker-compose (local PostgreSQL 16, MinIO, Mailpit, detector).
- **DEP-002**: Node.js Active LTS (minimum 22) and npm workspaces.
- **DEP-003**: Python 3.12 for the detector service and training scripts.
- **DEP-004**: PostgreSQL 16 or newer with `pgcrypto` and `pg_trgm`.
- **DEP-005**: npm packages: `express`, `zod`, `pg`, `node-pg-migrate`, `decimal.js`, `argon2`, `helmet`, `express-rate-limit`, `pino`, `pino-http`, `prom-client`, `multer`, `sharp`, `@aws-sdk/client-s3`, `nodemailer`, `ws`, `@sentry/node`, `@sentry/react`, `@asteasolutions/zod-to-openapi`; web: `react`, `react-router`, `@tanstack/react-query`, `tailwindcss`, `recharts`, Vitest, `@testing-library/react`; test: `supertest`, `@playwright/test`, `@axe-core/playwright`, `autocannon`.
- **DEP-006**: Python packages (pinned in lock files): `fastapi`, `uvicorn`, `pydantic`, `scikit-learn`, `joblib`, `numpy`; training: `datasets`, `pandas`, `matplotlib`, `torch`, `transformers`, `accelerate`, `pytest`, `httpx`, `ruff`, `mypy`, `pip-audit`.
- **DEP-007**: LIAR dataset on Hugging Face (`ucsbnlp/liar`); license terms recorded in `docs/DATASETS.md` (TASK-029).
- **DEP-008**: Base model `distilroberta-base` from Hugging Face for the transformer candidate; license recorded in `MODEL_CARD.md` (TASK-031).
- **DEP-009**: Optional GPU (for example a free notebook GPU) to train the transformer; CPU training is permitted but slow.
- **DEP-010**: Managed services for production: Render (web services), Neon (PostgreSQL), Cloudflare R2 (S3-compatible storage), a transactional SMTP provider, GitHub Actions. Limits re-verified in TASK-121.
- **DEP-011**: Git LFS, only if the transformer is selected.
- **DEP-012**: Phase order: Phase 1 precedes all. Phase 2 precedes Phases 3 and 5. Phase 3 precedes Phases 7 and 9. Phase 4 precedes Phase 6 and TASK-117. Phase 5 precedes Phases 6, 8, 10 and 12. Phase 6 and Phase 7 precede Phases 9 and 11. Phase 11 precedes TASK-098. Phases 1 to 11 precede Phase 12 admin screens; Phases 12 to 14 precede Phase 15; Phase 15 precedes TASK-129 on staging; TASK-133 is last.

## 5. Files

- **FILE-001**: `package.json`, `tsconfig.base.json`, `.nvmrc`, `.env.example`, `docker-compose.yml`, `render.yaml`, `Dockerfile`, `README.md` - repository root configuration.
- **FILE-002**: `.github/workflows/ci.yml`, `smoke.yml`, `backup.yml` - automation.
- **FILE-003**: `packages/shared/src/enums.ts`, `packages/shared/src/schemas/*.ts` - shared enums and Zod schemas.
- **FILE-004**: `apps/api/src/config.ts`, `logger.ts`, `app.ts`, `index.ts`, `static.ts` - API core.
- **FILE-005**: `apps/api/src/db/pool.ts`, `tx.ts`, `cursor.ts`, `errors.ts`, `migrations/0001_core_identity.sql` to `0005_search_and_views.sql` - database layer.
- **FILE-006**: `apps/api/src/middleware/originCheck.ts`, `security.ts`, `rateLimit.ts`, `validate.ts`, `auth.ts`, `errors.ts` - middleware.
- **FILE-007**: `apps/api/src/modules/auth/*`, `users/*`, `media/*`, `posts/*`, `feed/*`, `score/*`, `search/*`, `notifications/*`, `messages/*`, `admin/*`, `email/*`, `health/*` - modules (each with routes, service, repo, index).
- **FILE-008**: `apps/api/src/modules/governance/reports.ts`, `assessments.ts`, `appeals.ts` - governance services.
- **FILE-009**: `apps/api/src/modules/social/likes.ts`, `comments.ts`, `follows.ts`, `blocks.ts`, `reshares.ts`, `suggestions.ts` - social services.
- **FILE-010**: `apps/api/src/scoring/pure.ts`, `events.ts`, `finalizeWave.ts`, `verify.ts`, `corrections.ts`, `tier.ts` - scoring engine.
- **FILE-011**: `apps/api/src/detection/client.ts`, `worker.ts`, `bands.ts`, `effects.ts` - detection integration.
- **FILE-012**: `apps/api/src/jobs/index.ts`, `waveScheduler.ts`, `autoReal.ts`, `mediaCleanup.ts` - background loops.
- **FILE-013**: `apps/api/src/realtime/bus.ts`, `sse.ts`, `ws.ts` - realtime.
- **FILE-014**: `apps/api/src/storage/s3.ts` - object storage client.
- **FILE-015**: `apps/api/test/**` - tests (setup, db, scoring, api, detection, governance, social, messages, admin, security).
- **FILE-016**: `apps/web/src/main.tsx`, `App.tsx`, `copy.ts`, `api/client.ts`, `components/*`, `pages/*`, `hooks/*` - web app.
- **FILE-017**: `services/detector/app/main.py`, `schemas.py`, `model.py`, `config.py`, `preprocess.py` - detector service.
- **FILE-018**: `services/detector/training/download_data.py`, `train_baseline.py`, `train_transformer.py`, `evaluate.py`, `select_model.py`, `select_thresholds.py` - training pipeline.
- **FILE-019**: `services/detector/artifacts/*`, `reports/*`, `MODEL_CARD.md`, `Dockerfile`, `requirements.txt`, `requirements-train.txt`, `tests/*` - detector artifacts and tests.
- **FILE-020**: `tools/fault-server/server.ts` - test-only fault-injecting HTTP server.
- **FILE-021**: `scripts/create-user.ts`, `create-admin.ts`, `verify-scores.ts`, `backup.sh`, `restore.sh`, `load-test.ts`, `smoke-prod.ts`, `demo-scenario.ts`, `init-test-db.sql` - operational scripts.
- **FILE-022**: `e2e/**` - Playwright configuration, helpers and specs.
- **FILE-023**: `docs/DECISIONS.md`, `DATASETS.md`, `DEPLOYMENT.md`, `OPERATIONS.md`, `SECURITY.md`, `PERFORMANCE.md`, `ARCHITECTURE.md`, `ER.md`, `PAPER_MAPPING.md`, `DETECTOR.md`, `SCORING_TESTS.md`, `DEMO.md`, `REPORT.md`, `LIMITATIONS.md`, `openapi.yaml`, `screenshots/` - documentation.

## 6. Testing

All tests use real services (REQ-002, REQ-017). Numeric cases use exact decimal strings.

- **TEST-001**: Decomposition. `sigma = 0.5`, `R = [3, -1, 2, 0, 4]` gives Q after each wave `1.5, 1.0, 2.0, 2.0, 4.0`; final equals `sigma * sum(R) = 4.0`.
- **TEST-002**: Monotone non-decreasing. `sigma = 0.8`, `R = [1, 0, 2, 3]` gives `0.8, 0.8, 2.4, 4.8`.
- **TEST-003**: Monotone non-increasing. `sigma = 0.8`, `R = [-1, 0, -2, -3]` gives `-0.8, -0.8, -2.4, -4.8`.
- **TEST-004**: Sensitivity scaling. `R = [2, -1, 3]`, user a `sigma = 1.0`, user b `sigma = 0.25`: finals `4.0` and `1.0`, and `abs(Qa) > abs(Qb)`.
- **TEST-005**: Scaling caveat. `R = [2, -2]` (sum 0): both users end at `0` for any sigma.
- **TEST-006**: `sigma = 0`. `R = [5, -3, 7]` gives `0, 0, 0`.
- **TEST-007**: `sigma = 1`. `R = [2, -1, 3]` gives `2, 1, 4` (each update equals R).
- **TEST-008**: `R = 0` for all waves, `sigma = 0.7`: `0, 0, 0`.
- **TEST-009**: Alternating. `sigma = 0.5`, `R = [2, -2, 2, -2, 2]` gives `1, 0, 1, 0, 1`.
- **TEST-010**: Opposite behaviour. `sigma = 0.6`, user i `R = +3` and user j `R = -3` for 4 waves: `Qi = 7.2`, `Qj = -7.2`, difference `14.4 = 2 * 0.6 * 3 * 4`.
- **TEST-011**: `computeR` with adjustments: `(3, 1, -1)` gives `1`; `(0, 0, 0)` gives `0`; `(0, 2, 1)` gives `-1`.
- **TEST-012**: Decimal exactness: `sigma = 0.100`, `R = 3` applied 10 times equals exactly `3.000`; `foldHistory` equals `decomposedScore` for 1,000 histories generated from a fixed seed.
- **TEST-013**: TEST-001 through the database: events producing `R = [3, -1, 2, 0, 4]` over five finalized waves for one user with `sigma = 0.5` give ledger `q_after` values `1.5, 1.0, 2.0, 2.0, 4.0` and `users.q = 4.000`.
- **TEST-014**: Same events for two users with `sigma` 0.8 and 0.4: final `q` values satisfy `q_a = 2 * q_b`, identical `r` per wave; users with `sigma` 1.0 and 0.25 give `4.000` and `1.000`.
- **TEST-015**: `sigma = 0` user stays at `0.000` while ledger rows still record non-zero `r`; `sigma = 1` user's `delta` equals `r`.
- **TEST-016**: Calling finalize twice on the same wave returns `alreadyFinalized = true` the second time and changes no row (hash of ledger rows equal before and after).
- **TEST-017**: Ten parallel finalize calls produce exactly one finalized wave, one new open wave with number + 1, and one ledger row per user.
- **TEST-018**: Bystanders and users created after the wave opened receive `r = 0` rows and invariant I1 holds.
- **TEST-019**: After closing every connection and starting a fresh pool, scores and history are identical; also after logout and login through the API.
- **TEST-020**: `verifyScores` passes (I1 to I6) after a multi-wave scenario with several users.
- **TEST-021**: Correction after finalization: `sigma = 0.5`, a counted `-1` yields `q = -0.500`; overturn creates a `+1` reversal; after the next finalization `q = 0.000`; the old ledger row, counted event and old assessment are unchanged (JSON equality).
- **TEST-022**: Superseding before finalization voids eligible events with reason `assessment_superseded` and none of them is ever counted.
- **TEST-023**: Cascade: a fake assessment with author, two resharers and one reporter, then overturned, yields reversals `+1`, `+1`, `+1` for the author and resharers and `-1` for the reporter.
- **TEST-024**: `verifyScores` passes after several corrections and appeals.
- **TEST-025**: Tamper detection: with the ledger trigger disabled by the database owner, editing `q_after` of one row makes `verifyScores` report invariant I2 or I3 for that user; re-enabling the trigger restores protection.
- **TEST-026**: fake, then real, then fake again for the same post creates three assessments without unique violations and the verifier passes.
- **TEST-040**: Register creates a user with `sigma = SIGMA_DEFAULT`, `q = 0.000`, an unverified email and a queued verification mail.
- **TEST-041**: Duplicate username or email (case-insensitive) returns 409 `USERNAME_TAKEN` or `EMAIL_TAKEN`.
- **TEST-042**: Login success sets the cookie with `HttpOnly`, `SameSite=Lax` and `Secure` per config; wrong password and unknown user both return the same 401 body.
- **TEST-043**: Five failed logins in 15 minutes lock further attempts with 429.
- **TEST-044**: Logout deletes the session; the old cookie returns 401.
- **TEST-045**: An expired session returns 401 and is deleted.
- **TEST-046**: Email verification through a real Mailpit message works once; an expired or reused token fails.
- **TEST-047**: Forgot-password for an unknown email returns 204 with no mail; reset changes the password and deletes all sessions.
- **TEST-050**: Admin verdict `real` creates one eligible `RESPONSIBLE_POST` (+1) in the open wave.
- **TEST-051**: Verdict `fake` creates one eligible `MISINFO_POST` (-1) and only when the source is `admin`.
- **TEST-052**: Verdict `fake` also creates `MISINFO_RESHARE` for each non-deleted resharer and `VALID_REPORT` for each open reporter, and resolves reports.
- **TEST-053**: Verdict `unverifiable` creates no events and resolves reports.
- **TEST-054**: Posting the same verdict twice returns 409 `ALREADY_EXISTS` and creates no extra events.
- **TEST-055**: An admin cannot assess a post they authored, reshared or reported (403 `CONFLICT_OF_INTEREST`).
- **TEST-056**: The sixth `RESPONSIBLE_POST` for one user in one wave is stored as `voided` with `cap_exceeded`.
- **TEST-057**: A reshare deleted before the verdict produces no event.
- **TEST-058**: A reshare created while the verdict is `fake` produces an immediate eligible `MISINFO_RESHARE`.
- **TEST-059**: A post with band `uncertain` is in the queue and has no assessment and no event.
- **TEST-060**: A post with `failed_permanent` detection is in the queue, shows no label and creates no event.
- **TEST-061**: Queue order follows priority `3 * reports + reshares + band weight`, ties by oldest first.
- **TEST-062**: Opening an appeal holds the event; finalization excludes it; upheld releases it into the open wave.
- **TEST-063**: Appeals are rejected after the window, for another user's event, for positive events, and when one already exists.
- **TEST-064**: Every admin action writes an audit row and no endpoint can modify or delete audit rows.
- **TEST-065**: Suspended users cannot post, comment, like, follow, message or report; non-admins receive 403 on every admin endpoint.
- **TEST-066**: Responses to other users never include `p_fake`, sigma, `q` (under `tier_only`), email or password hash.
- **TEST-070**: Likes are idempotent; counts stay consistent under concurrent like and unlike.
- **TEST-071**: Comment creation, author and admin deletion, and rejection of deletion by others.
- **TEST-072**: Duplicate follow returns 409; self-follow returns 400.
- **TEST-073**: Blocking removes follows in both directions, hides posts and prevents follow, comment, reshare and message.
- **TEST-074**: Reshare confirmation is required for `auto_flagged`, `fact_checked_false` and low-tier originals and not otherwise.
- **TEST-075**: Post search ranks by relevance and excludes deleted, held and blocked authors' posts.
- **TEST-076**: User search matches username prefix and similar display names.
- **TEST-077**: Suggestions follow RUL-029 and ignore `q` and tier.
- **TEST-078**: Notifications are created exactly once per cause and never for self-actions.
- **TEST-079**: Feed pagination is stable across pages with identical timestamps.
- **TEST-080**: A message sent through REST arrives over a real WebSocket connection.
- **TEST-081**: Unread counts and conversation ordering are correct.
- **TEST-082**: Marking a thread read sets `read_at` and notifies the sender's connection.
- **TEST-083**: Blocked users cannot message each other.
- **TEST-084**: Suspended users cannot send messages.
- **TEST-085**: An unauthenticated WebSocket upgrade is rejected with 401.
- **TEST-086**: A WebSocket upgrade with a wrong Origin is rejected.
- **TEST-090**: Analytics and export endpoints return 403 for non-admins.
- **TEST-091**: Overview numbers equal counts computed directly from tables.
- **TEST-092**: Detector analytics confusion counts equal a direct SQL computation.
- **TEST-093**: CSV exports round-trip values containing commas, quotes and newlines.
- **TEST-094**: The spread query splits reshares before and after the label time correctly by tier.
- **TEST-100**: Detector contract tests (TASK-035): schema, range, determinism, 401, 422, health, model-info.
- **TEST-101**: Detector fault tests (TASK-052): each fault yields the expected `error_code`, backoff schedule, `failed_permanent`, no label, no assessment, no event.
- **TEST-102**: Real detector integration (TASK-053): result stored with model name and version; retry after detector restart; edit creates a new revision row.
- **TEST-103**: Database constraint tests (TASK-017).
- **TEST-104**: Enum parity between migrations and shared enums (TASK-018).
- **TEST-105**: Authorization matrix for every Phase 5 endpoint (TASK-047).
- **TEST-106**: Security headers, Origin check, unknown-key rejection and rate limits (TASK-103).
- **TEST-107**: Abuse tests: IDOR, mass assignment, injection strings, stored XSS as text, no SSRF (TASK-107).
- **TEST-108**: End-to-end suite F01 to F14 with axe checks (TASK-109).
- **TEST-109**: Load and concurrency gates (TASK-110).
- **TEST-110**: Detector regression against the golden file (TASK-111).
- **TEST-111**: Coverage gates (TASK-112).
- **TEST-112**: Demo scenario assertions: alice 4.8, bob -4.8, carol 2.4, dan 0.0, eve 1.6, `q = sigma * sum(r)` for all, `verify-scores` OK (TASK-129).
- **TEST-113**: Production smoke test (TASK-120).

## 7. Risks & Assumptions

- **RISK-001**: Detector accuracy on LIAR-style text is modest and the model does not generalize to arbitrary posts. Mitigation: bands, human review, no automatic penalties, honest reporting (CON-009).
- **RISK-002**: Free-tier limits change or the detector exceeds the memory limit. Mitigation: TASK-121 re-verification; the selection rule falls back to the small baseline; paid instance if needed.
- **RISK-003**: Admin workload grows. Mitigation: priority ordering in the queue, optional auto-real rule, and caps.
- **RISK-004**: Users evade penalties with new accounts. Mitigation: documented limitation; email verification required to post; rate limits.
- **RISK-005**: Cold starts delay the first detection. Mitigation: asynchronous detection, warm-up call, backoff retries, posts remain usable.
- **RISK-006**: Dataset license terms restrict use. Mitigation: record terms in `docs/DATASETS.md`; the platform is an academic project; replace the dataset by editing only the training scripts and the contract stays unchanged.
- **RISK-007**: `sharp` native binaries fail to build in a host image. Mitigation: use the Node LTS slim image with prebuilt binaries and test the Docker build in CI.
- **RISK-008**: Email deliverability to spam folders. Mitigation: verified sender domain and the outbox retry loop; Mailpit used in tests.
- **RISK-009**: Single API instance is a single point of failure. Mitigation: documented (CON-003); health checks and automatic restarts by the host.
- **ASSUMPTION-001**: Admins are trusted and act in good faith; conflict-of-interest and audit rules constrain but do not replace governance.
- **ASSUMPTION-002**: Users post English text.
- **ASSUMPTION-003**: Expected scale is hundreds to low thousands of users; the design does not target millions.
- **ASSUMPTION-004**: The wave definition, event rules, tiers, labels and appeals are engineering decisions of this plan and are not claims of the paper.
- **ASSUMPTION-005**: The production detector host has 512 MB of memory unless TASK-121 records otherwise.

## 8. Related Specifications / Further Reading

- Source paper: "Towards A Platform-Level Reward-Penalty Framework for Misinformation Intervention on Social Media" (provided PDF; Section 3 Equation 2, Section 4 Propositions 1 to 3).
- LIAR dataset paper: https://aclanthology.org/P17-2067/
- LIAR dataset card: https://huggingface.co/datasets/ucsbnlp/liar
- Render free web services: https://render.com/docs/free
- Neon pricing and limits: https://neon.com/pricing
- Hugging Face Spaces overview: https://huggingface.co/docs/hub/spaces-overview
- OWASP Password Storage Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
