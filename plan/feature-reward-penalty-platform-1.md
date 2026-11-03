---
goal: Build a production-grade Twitter-like platform with a real fake-news detector and the paper's wave-based reward-penalty scoring framework (Q(w+1) = Q(w) + sigma * R(w)), with no mocked components
version: 2.0
date_created: 2026-10-14
last_updated: 2026-11-03
owner: Project owner (undergraduate CS mini project, extended scope)
status: 'In progress - Phase 10 complete; Phase 11 next'
tags: [feature, architecture, full-stack, machine-learning, scoring, governance]
---

# Introduction

![Status: In progress](https://img.shields.io/badge/status-In_progress-blue)

This plan is the single source of truth for building the platform end to end. It is written for autonomous execution by a coding agent or a human. Every binding decision (stack, schema, API, scoring rules, detector behaviour, configuration values) is stated in Section 1. Section 2 contains ordered, atomic tasks grouped into phases. Section 9 provides the complete Traceability Matrix mapping every audit finding and policy decision to its tasks and tests. Section 10 documents residual edge-case defaults and asks for confirmation where the paper and prior specification leave sub-details open.

**Source paper:** "Towards A Platform-Level Reward-Penalty Framework for Misinformation Intervention on Social Media". The paper defines only: `Q_i(w+1) = Q_i(w) + sigma_i * R_i(w)`, `Q_i(1) = 0`, `sigma_i` in [0,1] fixed at initialization, `R_i(w)` computed once per wave (illustration: `R = n_plus - n_minus`), and the properties decomposition, monotonicity and sensitivity scaling. Everything else in this plan (waves as admin-finalized periods, event rules, detector, labels, tiers, appeals) is an engineering decision, labelled as such, and must not be attributed to the authors.

**No-mock policy (binding):** the product contains no mock detector, no fake data path, no feature flag that fabricates predictions, and no stubbed service in any runtime environment. Development, tests, CI and production all use the real PostgreSQL database, the real trained detector service, a real S3-compatible object store, and a real SMTP server (Mailpit locally, which is a real SMTP server that captures mail). The only test-only artifact is `tools/fault-server`, a real HTTP server that deliberately misbehaves so that failure handling of the detection client can be tested (REQ-002).

---

## 0. Finalized Reputation Policy Decisions & Specification Conflict Log (v2.0)

### 0.1 Binding Policy Decisions
- **DEC-001 (Likes on false posts):** Users who like an original post that is ultimately assessed as `fake` by an admin are penalized with a `MISINFO_LIKE` (-1) reputation event. Liking a post that already has a current admin `fake` assessment immediately creates an eligible `MISINFO_LIKE` (-1) event (unless the user is the post's author or already holds a non-voided `MISINFO_LIKE` event for that assessment). Unliking a post retracts the like (`deleted_at` set) and voids any `eligible` (unfinalized) `MISINFO_LIKE` event with `void_reason = 'interaction_retracted'`.
- **DEC-002 (Publisher reputation independence):** Faithful to the paper's Equations 1 and 2 (`R_i(w) = n_i^+(w) - n_i^-(w)` and `Q_i(w+1) = Q_i(w) + sigma_i * R_i(w)`), a user's reputation depends exclusively on their own eligible actions and their own fixed sensitivity `sigma_i`, never on the publisher's reputation `Q` or tier. Publisher tier only informs governance UI friction (`requiresShareConfirmation`, optional low-tier hold).
- **DEC-003 (Verified true reshares):** Users who reshare an original post that is verified as `real` by an admin (`source = 'admin'`, `verdict = 'real'`) are rewarded with a `RESPONSIBLE_RESHARE` (+1) event, subject to a per-wave cap `MAX_RESPONSIBLE_RESHARE_EVENTS_PER_WAVE`. Resharing a post that already holds a current admin `real` assessment immediately creates an eligible `RESPONSIBLE_RESHARE` (+1) event (subject to the cap). (`auto_real` assessments never create `RESPONSIBLE_RESHARE` events because they represent unreviewed low-risk posts rather than human-verified truth.)
- **DEC-004 (Viral false posts - flat publisher penalty):** The publisher of an admin-assessed `fake` post receives a flat `-1` (`MISINFO_POST`) per false post. The publisher's penalty never scales with likes, reshares, reach, or engagement volume.
- **DEC-005 (Reshare retraction):** Deleting a reshare (`DELETE /posts/:id/reshare` or `DELETE /posts/:reshareId`) before the post is assessed excludes it from event generation. Deleting a reshare *after* an event (`MISINFO_RESHARE` or `RESPONSIBLE_RESHARE`) has been created cancels that event (`status = 'voided'`, `void_reason = 'interaction_retracted'`) **if and only if** the event's status is `eligible` (or `held` with any open appeal auto-closed) and the wave has not been finalized. Counted events in finalized waves remain strictly immutable (`events_guard_trg`, `ledger_guard_trg`).
- **DEC-006 (Comments excluded from scoring):** Comments never generate reputation events. Evaluating comment stance requires semantic/sentiment NLP outside scope.

### 0.2 Conflict Resolution Log (v1.0 vs. v2.0)

| v1.0 Rule / Artifact | Conflict with Audit / Policy Decisions | Prescribed v2.0 Update |
|---|---|---|
| `RUL-002`, `RUL-003`, `packages/shared/src/enums.ts` | Listed only 5 event kinds and stated *"Likes, comments, follows, messages and blocks never create events."* Ignored verified-true reshares. | Expand event kinds to 7: `RESPONSIBLE_POST` (+1), `RESPONSIBLE_RESHARE` (+1), `VALID_REPORT` (+1), `MISINFO_POST` (-1), `MISINFO_RESHARE` (-1), `MISINFO_LIKE` (-1), `REVERSAL` (+1/-1). Update `RUL-003` so likes on original posts participate in `MISINFO_LIKE`, while comments, follows, messages, and blocks never create events. |
| `RUL-004` (Event generation on assessment) | Only penalized resharers on `fake`; did not reward resharers on admin `real`; did not penalize likers on `fake`; resolved open reports on `unverifiable`/`real` causing reporters to lose `VALID_REPORT` if later superseded by `fake`; penalized good-faith resharers when an admin `real` verdict was overturned to `fake`. | Update `RUL-004` & `RUL-015`: (1) Admin `real` creates `RESPONSIBLE_POST` for author and `RESPONSIBLE_RESHARE` for non-deleted resharers (`author_id <> post.author_id`); (2) Admin `fake` creates `MISINFO_POST` for author, `MISINFO_RESHARE` for eligible resharers, `MISINFO_LIKE` for active likers (`user_id <> post.author_id`), and `VALID_REPORT` for all users who reported the post prior to the `fake` assessment (whether report status was `open` or previously `resolved`); (3) Protect good-faith resharers/likers who interacted while an admin `real` (`fact_checked_true`) assessment was active from retroactive penalties if overturned to `fake`. |
| `RUL-005` (Caps) | Defined caps only for `RESPONSIBLE_POST` and `VALID_REPORT`. | Add `MAX_RESPONSIBLE_RESHARE_EVENTS_PER_WAVE` (default `5`) for `RESPONSIBLE_RESHARE`. |
| `RUL-013`, `0005_search_and_views.sql` (`review_queue_v`) | `NOT EXISTS (SELECT 1 FROM assessments a WHERE a.post_id = p.id AND a.is_current)` blocked `auto_real`-assessed posts from entering the admin review queue when later reported by users. | Update `review_queue_v` and `RUL-013` so posts whose current assessment has `source = 'auto_real'` enter the review queue whenever they have at least one `open` report (`COALESCE(rp.open_reports, 0) > 0`). |
| `RUL-019` & `0004_social.sql` (`likes` & `posts`) | `RUL-019` only allowed reshare retraction *before* the verdict. `likes` used hard `DELETE` with no audit trail or target-kind check. Repeated reshares/likes after retraction could collide with `events_one_per_assessment_uq`. | (1) `likes` table gains `updated_at` and `deleted_at` (soft delete on unlike) and a trigger enforcing likes on original posts (or resolving to original post); (2) Retracting a reshare or like while its event is `eligible` transitions the event to `status = 'voided'`, `void_reason = 'interaction_retracted'`; (3) Re-sharing or re-liking under the same assessment reactivates a previously `interaction_retracted` event (subject to wave openness and caps) or `DO NOTHING` if already active (`PAT-005`). |

---

## 1. Requirements & Constraints

### 1.1 System architecture

```
                              ┌───────────────────────────────────────────────┐
  Browser (React SPA)  ─────▶ │  API process (Node.js + Express 5, 1 instance)│
  HTTPS, cookie "sid"         │  ├─ HTTP /api/v1/*   (REST, JSON)             │
  SSE + WebSocket             │  ├─ WebSocket /ws   (direct messages)         │
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

### 1.3 Domain model and binding rules (Updated for v2.0)

- **RUL-001 (Definitions):** A **prediction** is a `detection_results` row (model output, may be wrong). An **assessment** is an `assessments` row (reviewed verdict `real`/`fake`/`unverifiable` with rationale, or the narrow `auto_real` rule). A **reputation event** is a `reputation_events` row, created only from an assessment, an eligible post interaction (reshare/like on an already-assessed post), or a reversal. Only reputation events influence scores. A prediction never creates an event.
- **RUL-002 (Assessment sources & event polarity):**
  - Negative events (`MISINFO_POST`, `MISINFO_RESHARE`, `MISINFO_LIKE`) are created **only** from assessments with `source = 'admin'` and `verdict = 'fake'`.
  - Positive reshare and report events (`RESPONSIBLE_RESHARE`, `VALID_REPORT`) are created **only** from assessments with `source = 'admin'` (`verdict = 'real'` for `RESPONSIBLE_RESHARE`; `verdict = 'fake'` for `VALID_REPORT`).
  - The `auto_real` source may **only** create `RESPONSIBLE_POST` (+1) events for the original post author; it never creates `RESPONSIBLE_RESHARE` events.
- **RUL-003 (Event kinds and values):**
  - `RESPONSIBLE_POST` (+1): authoring an original post assessed as `real` (`admin` or `auto_real`).
  - `RESPONSIBLE_RESHARE` (+1): resharing an original post assessed by an `admin` as `real` (only when `RESPONSIBLE_RESHARE_REWARD_ENABLED=true`, default `true`, and `resharer_id <> post.author_id`).
  - `VALID_REPORT` (+1): reporting an original post that is assessed by an `admin` as `fake` (`reporter_id <> post.author_id`).
  - `MISINFO_POST` (-1): authoring an original post assessed by an `admin` as `fake` (flat `-1` regardless of engagement volume; DEC-004).
  - `MISINFO_RESHARE` (-1): resharing an original post assessed by an `admin` as `fake` (only when `RESHARE_PENALTY_ENABLED=true`, default `true`, and `resharer_id <> post.author_id`).
  - `MISINFO_LIKE` (-1): liking an original post assessed by an `admin` as `fake` (only when `LIKE_PENALTY_ENABLED=true`, default `true`, and `liker_id <> post.author_id`; DEC-001).
  - `REVERSAL` (+1 or -1, always opposite to the `counted` event it reverses).
  - Comments, follows, messages, and blocks **never** create reputation events (DEC-006). Publisher reputation `Q` or tier **never** weights or scales any event value (DEC-002).
- **RUL-004 (Event generation on assessment creation & post-assessment interactions):**
  When an assessment `A` is created for original post `P` (authored by `U`):
  - **Verdict `real` (`source = 'auto_real'`):**
    - Create `RESPONSIBLE_POST` (+1) for `U`.
  - **Verdict `real` (`source = 'admin'`):**
    - Create `RESPONSIBLE_POST` (+1) for `U`.
    - If `RESPONSIBLE_RESHARE_REWARD_ENABLED=true`, create `RESPONSIBLE_RESHARE` (+1) for every user `X <> U` who has a non-deleted reshare of `P` at that moment.
    - All `open` reports on `P` become `resolved`.
    - Any subsequent reshare of `P` by `X <> U` created while `A` (`admin`, `real`) remains `is_current = true` immediately creates `RESPONSIBLE_RESHARE` (+1) in the then-open wave.
  - **Verdict `fake` (`source = 'admin'`):**
    - Create `MISINFO_POST` (-1) for `U`.
    - If `RESHARE_PENALTY_ENABLED=true`, create `MISINFO_RESHARE` (-1) for every user `X <> U` with a non-deleted reshare of `P` at that moment, **except** reshares protected by the Good-Faith Window in `RUL-015` (i.e., reshares created while a prior `admin` assessment with `verdict = 'real'` was active).
    - If `LIKE_PENALTY_ENABLED=true`, create `MISINFO_LIKE` (-1) for every user `X <> U` with an active (`deleted_at IS NULL`) like on `P` at that moment, **except** likes protected by the Good-Faith Window in `RUL-015` (i.e., likes created or last re-liked while a prior `admin` assessment with `verdict = 'real'` was active).
    - Create `VALID_REPORT` (+1) for every reporter `X <> U` with a report on `P` created at or before `A.created_at` (including reports whose `status` is `'open'` **and** reports that were previously set to `'resolved'` by a superseded assessment on `P`, provided the reporter has not already received a non-voided, non-reversed `VALID_REPORT` on `P`). All `open` reports on `P` become `resolved`.
    - Any subsequent reshare or like on `P` by `X <> U` created while `A` (`admin`, `fake`) remains `is_current = true` immediately creates `MISINFO_RESHARE` (-1) or `MISINFO_LIKE` (-1) in the then-open wave.
  - **Verdict `unverifiable` (`source = 'admin'`):**
    - No events created; all `open` reports on `P` become `resolved`.
  - **Uniqueness & Idempotency:** Each `(assessment_id, user_id, kind)` tuple (where `kind <> 'REVERSAL'`) yields at most one row in `reputation_events` (`events_one_per_assessment_uq`).
- **RUL-005 (Per-wave positive event caps):**
  - For `RESPONSIBLE_POST`: at most `MAX_RESPONSIBLE_POST_EVENTS_PER_WAVE` (default `5`) non-voided events per user per wave.
  - For `RESPONSIBLE_RESHARE`: at most `MAX_RESPONSIBLE_RESHARE_EVENTS_PER_WAVE` (default `5`) non-voided events per user per wave.
  - For `VALID_REPORT`: at most `MAX_VALID_REPORT_EVENTS_PER_WAVE` (default `5`) non-voided events per user per wave.
  - An event beyond the cap is inserted with `status = 'voided'`, `void_reason = 'cap_exceeded'`. Negative events (`MISINFO_POST`, `MISINFO_RESHARE`, `MISINFO_LIKE`) have no cap.
- **RUL-006 (Waves):** Exactly one wave is `open` at any time (partial unique index). The migration creates wave number 1 as open. Finalizing wave `w` opens wave `w+1` in the same transaction. Finalization is triggered by an admin (`POST /admin/waves/:id/finalize`) or by the scheduler when `WAVE_AUTO_FINALIZE_INTERVAL_HOURS > 0` and `opened_at + interval <= now()`.
- **RUL-007 (Wave assignment):** A new or reactivated event attaches to the wave that is `open` at the moment the event becomes `eligible` (`wave_id` = open wave id, `status = 'eligible'`). Event creation/reactivation/retraction locks the open wave row with `FOR SHARE`; finalization locks it with `FOR UPDATE`, serializing all wave assignments against finalization.
- **RUL-008 (Appeals & held events):** An event whose assessment has an open appeal is `held` with `wave_id = NULL`. On appeal `upheld`, it becomes `eligible` with `wave_id` = currently open wave. On `overturned`, `RUL-015` applies.
- **RUL-009 (Wave-level reputation & Equation 2):**
  `R_i(w) = n_pos - n_neg + n_adj`, where for user `i` and wave `w` over events with `wave_id = w` and `status = 'eligible'`:
  - `n_pos` = count of kinds `RESPONSIBLE_POST`, `RESPONSIBLE_RESHARE`, and `VALID_REPORT`;
  - `n_neg` = count of kinds `MISINFO_POST`, `MISINFO_RESHARE`, and `MISINFO_LIKE`;
  - `n_adj` = sum of `value` over kind `REVERSAL`.
  Without reversals this is the paper's Equation 1 (`R_i(w) = n_i^+(w) - n_i^-(w)`). The score update is Equation 2: `q_after = q_before + sigma * R`.
- **RUL-010 (Sigma policy):** `sigma` is set once at account creation. Registration through the API uses `SIGMA_DEFAULT` (0.500). The CLI `scripts/create-user.ts --sigma <0..1>` may set another value at creation. No API endpoint, admin action or SQL path may change sigma (database trigger). Sigma is never derived from age, verification, followers or engagement.
- **RUL-011 (Tiers):** `trusted` if `q >= Q_TRUSTED_MIN`; `low` if `q <= Q_LOW_MAX`; otherwise `neutral`. Tier is derived at read time from `users.q`. Posts store `author_tier_at_post` at creation for analytics.
- **RUL-012 (Public label of a post):** Computed by view `post_public_status_v`: current assessment verdict `fake` gives `fact_checked_false`; verdict `real` with source `admin` gives `fact_checked_true`; verdict `real` with source `auto_real` gives `none`; verdict `unverifiable` gives `unverifiable`; with no current assessment, latest detection band `likely_fake` gives `auto_flagged`; everything else `none`. A boolean `under_appeal` is true when any event of the current assessment has an open appeal.
- **RUL-013 (Review queue - Updated for Audit Gap 4):**
  `review_queue_v` includes original posts (`kind = 'original'`) that have **no current `admin` assessment** (`NOT EXISTS (SELECT 1 FROM assessments a WHERE a.post_id = p.id AND a.is_current AND a.source = 'admin')`) and satisfy:
  1. If the post has a current `auto_real` assessment, it is included **if and only if** it has at least one `open` report (`COALESCE(rp.open_reports, 0) > 0`).
  2. If the post has no current assessment at all, it is included if: latest detection band in (`likely_fake`, `uncertain`), OR latest detection status `failed_permanent`, OR at least one `open` report, OR post status `held`.
  Deleted posts are included only if they have at least one reshare, one open report, or band `likely_fake`. Priority = `3 * open_reports + reshares + (5 if band = likely_fake, 2 if uncertain, else 0)`; order `priority DESC, created_at ASC`.
- **RUL-014 (Auto-real rule):** When `AUTO_REAL_ENABLED=true`, job runs every 60 s: create an assessment with `source = 'auto_real'`, `verdict = 'real'`, rationale `'Automated: low model risk, no reports, review window elapsed.'` for original posts where: status `published`, latest detection `ok` for the current revision with `p_fake <= REAL_THRESHOLD_LOW`, zero reports (any status), no assessment ever, `created_at <= now() - AUTO_REAL_DELAY_MINUTES minutes`, author status `active`. When an `auto_real` post is later reported and assessed by an admin, `RUL-015` supersedes the `auto_real` assessment.
- **RUL-015 (Supersede cascade & Good-Faith Window protection - Updated for Audit Gaps 5 & 6):**
  Creating an assessment `A_new` for a post `P` that already has a current assessment `A_old`:
  1. Set `A_old.is_current = false`, insert `A_new` with `supersedes_id = A_old.id` and `is_current = true`.
  2. For every event of `A_old`:
     - If `status IN ('eligible', 'held')`: update to `status = 'voided'`, `void_reason = 'assessment_superseded'`, `wave_id = NULL` (and if any open appeal exists on that event, mark the appeal `overturned` with system note `'Superseded by new assessment'`).
     - If `status = 'counted'`: leave the counted event untouched and insert a `REVERSAL` event (same `user_id`, `post_id`, `assessment_id = A_new.id`, `value = -original.value`, `reverses_event_id = original.id`, `status = 'eligible'`, `wave_id` = currently open wave).
  3. **Good-Faith Window Protection:** Compute all time intervals `[t_start, t_end]` on post `P` during which an assessment with `source = 'admin'` and `verdict = 'real'` was the current assessment (from `A_real.created_at` until the `created_at` of the assessment that superseded `A_real`). When `A_new.verdict = 'fake'`, any reshare whose `created_at` falls inside a Good-Faith Window, and any like whose `updated_at` falls inside a Good-Faith Window, is **exempt** from `MISINFO_RESHARE` and `MISINFO_LIKE` penalties under `A_new`.
  4. Run `RUL-004` for `A_new` (including historical reporters whose reports were resolved by `A_old` or earlier assessments on `P`).
- **RUL-016 (Appeals):** Any user holding a non-voided negative event (`MISINFO_POST`, `MISINFO_RESHARE`, `MISINFO_LIKE`) may open one appeal for that event within `APPEAL_WINDOW_DAYS` of the assessment's `created_at`. Opening sets the event `held` (if `eligible`; if `counted` the event stays counted and the appeal can only result in a reversal). Admin resolves as `upheld` (RUL-008) or `overturned` with a required new verdict `real` or `unverifiable`, which creates a superseding assessment via RUL-015 and records `new_assessment_id`.
- **RUL-017 (Post edit):** Author may edit body and `source_url` only when: status is not `deleted`, age <= `EDIT_WINDOW_MINUTES`, no assessment exists, no open report exists. Editing increments `revision`, stores the previous body in `post_revisions`, and enqueues a new detection row for the new revision.
- **RUL-018 (Post deletion):** Author soft-deletion of an *original* post (`status = 'deleted'`) never cancels assessments, events, reports, or appeals. Deleted posts disappear from feeds, search and profiles; they remain visible to admins and in the author's score history.
- **RUL-019 (Reshares & Reshare Retraction - Updated for DEC-003, DEC-005 & Audit Gap 7):**
  - A reshare is a `posts` row with `kind = 'reshare'` pointing to an original post `P`. One non-deleted reshare per `(user, P)`. Optional comment up to 500 chars.
  - If `P`'s label is `auto_flagged`, `fact_checked_false`, or `P`'s author's tier is `low`, `POST /posts/:id/reshare` requires `acknowledgedWarning = true`, else `409 CONFIRMATION_REQUIRED`.
  - **Retraction before assessment:** Deleting a reshare (`DELETE /posts/:id/reshare` or `DELETE /posts/:reshareId`) sets `status = 'deleted'`, `deleted_at = now()`. Because it is deleted, future assessments on `P` ignore it (`RUL-004`).
  - **Retraction after assessment (before wave finalization):** When a user deletes their reshare of `P`, if there is a `reputation_events` row for `(assessment_id = current_assessment.id, user_id, kind IN ('MISINFO_RESHARE', 'RESPONSIBLE_RESHARE'))` with `status IN ('eligible', 'held')` (meaning its wave has **not** been finalized):
    - Lock the open wave with `FOR SHARE`.
    - Update the event to `status = 'voided'`, `void_reason = 'interaction_retracted'`, `wave_id = NULL`.
    - If the event had an `open` appeal, auto-close the appeal (`status = 'overturned'`, `resolved_at = now()`, `resolution_note = 'Closed automatically: reshare retracted before wave finalization'`).
    - If the event already has `status = 'counted'` (wave finalized), the event and ledger row are **untouched** (immutability preserved).
  - **Repeated reshare under same assessment (`PAT-005`):** If the user later reshares `P` again while the same assessment `A` is still current:
    - If no event exists for `(A.id, user_id, kind)`, insert it per `RUL-004`/`RUL-005`.
    - If an event exists for `(A.id, user_id, kind)` with `status = 'voided'` and `void_reason = 'interaction_retracted'`, reactivate that row in-place (`status = 'eligible'`, `void_reason = NULL`, `wave_id` = open wave id, or keep `status = 'voided'`, `void_reason = 'cap_exceeded'` if `RESPONSIBLE_RESHARE` cap is now full).
    - If an event exists with `status IN ('eligible', 'held', 'counted')` or `void_reason = 'cap_exceeded'`, do nothing (`ON CONFLICT DO NOTHING` semantics—never duplicate or error).
- **RUL-020 (Reports):** One report per `(user, post)`. A user cannot report their own post. Reports on deleted posts are rejected with 404. Report reasons: `false_information`, `misleading`, `spam`, `harassment`, `other`.
- **RUL-021 (Conflict of interest):** An admin cannot create an assessment or resolve an appeal for a post they authored, reshared, reported, or liked. Violations return 403 `CONFLICT_OF_INTEREST`.
- **RUL-022 (User status lifecycle):** Suspended users cannot post, comment, like, follow, message or report, but can log in and view their score and appeals. Account deletion anonymizes PII (username `deleted_` + first 8 hex chars of id, email `deleted+<id>@invalid.local`, display name `Deleted user`, bio empty, avatar removed, password hash replaced), sets `status = 'deleted'`, deletes sessions, keeps posts, ledger and events. Ledger rows exist for users of every status.
- **RUL-023 (Score visibility):** Public users see: label, `under_appeal`, author tier badge, counts. The author and admins additionally see detection status and band, and for admins also `p_fake`, model name and version. Numeric `q` and sigma are visible only to the user and admins when `PUBLIC_SCORE_VISIBILITY = 'tier_only'` (default); `'full'` makes `q` public (sigma stays private).
- **RUL-024 (Low-tier hold):** When `HOLD_LOW_TIER_POSTS=true`, a new original post by a user whose tier is `low` gets `status = 'held'` (visible only to the author and admins) and appears in the review queue. An admin releases it (`POST /admin/posts/:id/release`, status `published`) or removes it (`DELETE /admin/posts/:id`, status `deleted`). Default is `false`.
- **RUL-025 (Notifications):** Notification types: `post_flagged`, `assessment_decided`, `appeal_opened`, `appeal_resolved`, `report_resolved`, `wave_finalized`, `new_follower`, `like`, `comment`, `reshare`, `message`. Each is created in the same transaction as the triggering change and pushed to SSE after commit. Users never receive a notification about their own action.
- **RUL-026 (Detection lifecycle):** On post create or edit insert a `detection_results` row `queued`. Worker claims rows with `status IN ('queued','failed') AND next_attempt_at <= now()` using `FOR UPDATE SKIP LOCKED`, sets `running`. Success: status `ok` with `p_fake`, `band`, model fields. Failure: `attempts += 1`; if `attempts < DETECTOR_MAX_ATTEMPTS` status `failed` and `next_attempt_at = now() + DETECTOR_BACKOFF_SECONDS[attempts-1]`; else `failed_permanent`. A `running` row older than 120 s is reset to `failed` by the worker. A failed prediction never creates a label, assessment or event.
- **RUL-027 (Detection bands):** `p_fake >= FAKE_THRESHOLD_HIGH` gives `likely_fake`; `p_fake <= REAL_THRESHOLD_LOW` gives `likely_real`; otherwise `uncertain`. Bands are computed by the API, not the detector.
- **RUL-028 (Blocks):** If A blocks B: B cannot follow A, message A, comment on A's posts or reshare A's posts; existing follows in both directions are deleted; A's posts are hidden from B's feed and search. Blocks do not affect scoring.
- **RUL-029 (Who-to-follow suggestions):** Candidates are users followed by users the viewer follows, excluding the viewer, already-followed users, blocked users (either direction), and suspended or deleted users. Rank by number of mutual followed-by connections descending, then `created_at` descending. If fewer than 10 candidates, fill with the most-followed active users not already excluded. The ranking never uses `q` or tier.
- **RUL-030 (Search):** Posts: PostgreSQL full text (`websearch_to_tsquery('english', q)` against `body_tsv`), published posts only, ordered by `ts_rank` descending then `created_at` descending. Users: `username ILIKE q || '%'` or `similarity(display_name, q) > 0.3`, ordered by similarity descending. Minimum query length 2.
- **RUL-031 (Feeds):** Global feed and Following feed are strictly chronological (`created_at` descending, `id` descending) with cursor pagination. No ranking or demotion by reputation (the paper's amplification signals are expressed only through labels, tiers, confirmation prompts and the optional hold in RUL-024).
- **RUL-032 (Likes & Like Retraction Lifecycle - Added for DEC-001 & Audit Gaps 1 & 7):**
  - Likes are permitted only on `original` posts (`kind = 'original'`). Attempting to like a `reshare` row directly returns `400 VALIDATION_ERROR` (the client likes the target original post).
  - `POST /posts/:id/like` is idempotent:
    - If no row exists in `likes` for `(user_id, post_id)`, insert `(user_id, post_id, created_at = now(), updated_at = now(), deleted_at = NULL)`.
    - If a row exists with `deleted_at IS NOT NULL`, update it to `deleted_at = NULL, updated_at = now()`.
    - If a row exists with `deleted_at IS NULL`, it is a no-op (`204`).
    - If the post currently has an active admin `fake` assessment (`is_current = true, source = 'admin', verdict = 'fake'`), `LIKE_PENALTY_ENABLED=true`, and `user_id <> post.author_id`:
      - If no `MISINFO_LIKE` event exists for `(assessment_id, user_id, 'MISINFO_LIKE')`, insert an `eligible` `MISINFO_LIKE` (-1) event attached to the currently open wave (locked `FOR SHARE`).
      - If a `MISINFO_LIKE` event exists with `status = 'voided'` and `void_reason = 'interaction_retracted'`, reactivate it to `status = 'eligible'`, `void_reason = NULL`, `wave_id` = currently open wave.
      - If a `MISINFO_LIKE` event exists with `status IN ('eligible', 'held', 'counted')`, do nothing.
  - `DELETE /posts/:id/like` is idempotent:
    - If an active row exists (`deleted_at IS NULL`), set `deleted_at = now(), updated_at = now()`.
    - If a `MISINFO_LIKE` event exists for the post's current assessment and `user_id` with `status IN ('eligible', 'held')` (wave not yet finalized), lock the open wave `FOR SHARE` and update the event to `status = 'voided'`, `void_reason = 'interaction_retracted'`, `wave_id = NULL` (and auto-close any open appeal on that event).
    - If the `MISINFO_LIKE` event already has `status = 'counted'`, it remains untouched (`counted` events are immutable).

---

### 1.4 Database specification (binding DDL - Updated for v2.0)

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

-- 0003_governance_scoring.sql (Updated for DEC-001, DEC-003, DEC-005)
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
  reshare_post_id uuid REFERENCES posts(id),
  kind text NOT NULL CHECK (kind IN (
    'RESPONSIBLE_POST',
    'RESPONSIBLE_RESHARE',
    'VALID_REPORT',
    'MISINFO_POST',
    'MISINFO_RESHARE',
    'MISINFO_LIKE',
    'REVERSAL'
  )),
  value smallint NOT NULL CHECK (value IN (-1, 1)),
  status text NOT NULL CHECK (status IN ('eligible','held','voided','counted')),
  wave_id uuid REFERENCES waves(id),
  reverses_event_id uuid REFERENCES reputation_events(id),
  void_reason text CHECK (
    void_reason IS NULL OR void_reason IN ('cap_exceeded','assessment_superseded','interaction_retracted')
  ),
  ledger_user_id uuid,
  ledger_wave_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (ledger_user_id, ledger_wave_id) REFERENCES user_wave_reputation (user_id, wave_id),
  CHECK (
    (kind IN ('RESPONSIBLE_POST','RESPONSIBLE_RESHARE','VALID_REPORT') AND value = 1)
    OR (kind IN ('MISINFO_POST','MISINFO_RESHARE','MISINFO_LIKE') AND value = -1)
    OR (kind = 'REVERSAL' AND reverses_event_id IS NOT NULL)
  ),
  CHECK ((status IN ('eligible','counted') AND wave_id IS NOT NULL) OR (status IN ('held','voided') AND wave_id IS NULL)),
  CHECK (status <> 'voided' OR void_reason IS NOT NULL),
  CHECK (status = 'voided' OR void_reason IS NULL),
  CHECK (status <> 'counted' OR (ledger_user_id = user_id AND ledger_wave_id = wave_id))
);
CREATE UNIQUE INDEX events_one_per_assessment_uq ON reputation_events (assessment_id, user_id, kind) WHERE kind <> 'REVERSAL';
CREATE UNIQUE INDEX events_one_reversal_uq ON reputation_events (reverses_event_id) WHERE kind = 'REVERSAL' AND status <> 'voided';
CREATE INDEX events_wave_idx ON reputation_events (wave_id, user_id) WHERE status = 'eligible';
CREATE INDEX events_user_idx ON reputation_events (user_id, created_at DESC);
CREATE INDEX events_post_assessment_idx ON reputation_events (post_id, assessment_id);

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
  resolved_by_system boolean NOT NULL DEFAULT false,
  resolution_note text,
  new_assessment_id uuid REFERENCES assessments(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CHECK (
    (status = 'open' AND resolved_at IS NULL)
    OR (status <> 'open' AND resolved_at IS NOT NULL AND (resolved_by IS NOT NULL OR resolved_by_system = true) AND char_length(coalesce(resolution_note,'')) >= 10)
  )
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

-- 0004_social.sql (Updated for DEC-001 soft-deletable & auditable likes)
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
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  PRIMARY KEY (user_id, post_id)
);
CREATE INDEX likes_post_active_idx ON likes (post_id) WHERE deleted_at IS NULL;

CREATE FUNCTION likes_target_original() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT kind FROM posts WHERE id = NEW.post_id) <> 'original' THEN
    RAISE EXCEPTION 'like target must be an original post' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER likes_target_original_trg BEFORE INSERT ON likes FOR EACH ROW EXECUTE FUNCTION likes_target_original();

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

-- 0005_search_and_views.sql (Updated for Audit Gap 4: reported auto_real posts enter review_queue_v)
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
  LEFT JOIN post_current_assessment_v ca ON ca.post_id = p.id
  LEFT JOIN post_latest_detection_v d ON d.post_id = p.id
  LEFT JOIN LATERAL (SELECT count(*) AS open_reports FROM reports r WHERE r.post_id = p.id AND r.status = 'open') rp ON true
  LEFT JOIN LATERAL (SELECT count(*) AS reshares FROM posts s WHERE s.reshare_of_post_id = p.id AND s.kind = 'reshare' AND s.status <> 'deleted') rs ON true
  WHERE p.kind = 'original'
    AND (
      (ca.id IS NULL AND (
        (d.status = 'ok' AND d.band IN ('likely_fake','uncertain'))
        OR d.status = 'failed_permanent'
        OR COALESCE(rp.open_reports, 0) > 0
        OR p.status = 'held'
      ))
      OR (ca.source = 'auto_real' AND COALESCE(rp.open_reports, 0) > 0)
    )
    AND (p.status <> 'deleted' OR COALESCE(rp.open_reports, 0) > 0 OR COALESCE(rs.reshares, 0) > 0 OR d.band = 'likely_fake');
```

### 1.5 Scoring specification (binding - Updated for v2.0)

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
4. Aggregate: for the wave, query:
```sql
SELECT
  user_id,
  count(*) FILTER (WHERE kind IN ('RESPONSIBLE_POST','RESPONSIBLE_RESHARE','VALID_REPORT')) AS n_pos,
  count(*) FILTER (WHERE kind IN ('MISINFO_POST','MISINFO_RESHARE','MISINFO_LIKE')) AS n_neg,
  COALESCE(sum(value) FILTER (WHERE kind = 'REVERSAL'), 0) AS n_adj
FROM reputation_events
WHERE wave_id = $1 AND status = 'eligible'
GROUP BY user_id;
```
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
- **I5** For each row, `n_pos` equals the count of `RESPONSIBLE_POST`, `RESPONSIBLE_RESHARE`, and `VALID_REPORT`; `n_neg` equals the count of `MISINFO_POST`, `MISINFO_RESHARE`, and `MISINFO_LIKE`; and `n_adj` equals sum of `value` over `REVERSAL` for matching `counted` reputation events.
- **I6** No event with `status = 'eligible'` has a `wave_id` pointing to a finalized wave.

`verifyScores` returns `{ok: boolean, issues: [{invariant, userId, waveId?, expected, actual}]}` and is exposed through `POST /api/v1/admin/verify-scores` and `scripts/verify-scores.ts` (exit code 1 on any issue).

**Event generation & interaction lifecycle functions in `apps/api/src/scoring/events.ts`:**

- **`createEventsForAssessment(tx, assessment)`**:
  - Locks the open wave (`SELECT id FROM waves WHERE status = 'open' FOR SHARE`).
  - Loads post (`id, author_id`).
  - Computes Good-Faith Windows `[(t_start, t_end), ...]` from previous assessments on `post.id` where `source = 'admin'` and `verdict = 'real'`.
  - If `assessment.verdict === 'real'`:
    - Inserts `RESPONSIBLE_POST` (+1) for `post.author_id` (checking `MAX_RESPONSIBLE_POST_EVENTS_PER_WAVE`).
    - If `assessment.source === 'admin'` and `config.RESPONSIBLE_RESHARE_REWARD_ENABLED`: queries all non-deleted reshares of `post.id` where `author_id <> post.author_id` (`ORDER BY created_at ASC, id ASC`) and inserts `RESPONSIBLE_RESHARE` (+1, `reshare_post_id = reshare.id`) for each resharer (checking `MAX_RESPONSIBLE_RESHARE_EVENTS_PER_WAVE` per resharer).
    - If `assessment.source === 'admin'`, updates `reports SET status = 'resolved' WHERE post_id = $1 AND status = 'open'`.
  - If `assessment.verdict === 'fake'` (always `source === 'admin'`):
    - Inserts `MISINFO_POST` (-1) for `post.author_id`.
    - If `config.RESHARE_PENALTY_ENABLED`: queries all non-deleted reshares of `post.id` where `author_id <> post.author_id` and `created_at` does not fall within any Good-Faith Window on `post.id`; inserts `MISINFO_RESHARE` (-1, `reshare_post_id = reshare.id`) for each.
    - If `config.LIKE_PENALTY_ENABLED`: queries all active likes (`deleted_at IS NULL`) on `post.id` where `user_id <> post.author_id` and `updated_at` does not fall within any Good-Faith Window on `post.id`; inserts `MISINFO_LIKE` (-1) for each.
    - Queries all reports on `post.id` where `reporter_id <> post.author_id` and `created_at <= assessment.created_at` and the reporter does not already have a non-voided, non-reversed `VALID_REPORT` event on `post.id`; inserts `VALID_REPORT` (+1, `report_id = report.id`) for each (checking `MAX_VALID_REPORT_EVENTS_PER_WAVE`). Updates `reports SET status = 'resolved' WHERE post_id = $1 AND status = 'open'`.
  - If `assessment.verdict === 'unverifiable'`:
    - Updates `reports SET status = 'resolved' WHERE post_id = $1 AND status = 'open'`.
- **`syncReshareEventOnCreate(tx, resharePost)`**:
  - Checks if `resharePost.reshare_of_post_id` has a current assessment `A` with `source = 'admin'` and `resharePost.author_id <> originalPost.author_id`.
  - If `A.verdict === 'fake'` and `config.RESHARE_PENALTY_ENABLED`: inserts `MISINFO_RESHARE` (-1) in the open wave (`FOR SHARE`), or if a row for `(A.id, user_id, 'MISINFO_RESHARE')` exists with `status = 'voided'` AND `void_reason = 'interaction_retracted'`, reactivates it to `status = 'eligible'`, `wave_id = openWave.id`, `void_reason = NULL`, `reshare_post_id = resharePost.id`.
  - If `A.verdict === 'real'` and `config.RESPONSIBLE_RESHARE_REWARD_ENABLED`: inserts or reactivates `RESPONSIBLE_RESHARE` (+1) in the open wave (`FOR SHARE`), applying `MAX_RESPONSIBLE_RESHARE_EVENTS_PER_WAVE` cap check (`cap_exceeded` if full).
- **`retractReshareEventOnDelete(tx, userId, originalPostId)`**:
  - Finds any `reputation_events` row for `user_id = userId`, `post_id = originalPostId`, `kind IN ('MISINFO_RESHARE', 'RESPONSIBLE_RESHARE')`, and `status IN ('eligible', 'held')`.
  - Locks the open wave (`FOR SHARE`), updates the event to `status = 'voided'`, `void_reason = 'interaction_retracted'`, `wave_id = NULL`, and auto-closes any open appeal on that event (`status = 'overturned'`, `resolved_by_system = true`, `resolved_at = now()`, `resolution_note = 'Closed automatically: reshare retracted before wave finalization'`).
  - If the event has `status = 'counted'`, does nothing.
- **`syncLikeEventOnLike(tx, userId, originalPostId)`**:
  - Checks if `originalPostId` has a current assessment `A` with `source = 'admin'`, `verdict = 'fake'`, `config.LIKE_PENALTY_ENABLED`, and `userId <> originalPost.author_id`.
  - Locks the open wave (`FOR SHARE`). Inserts `MISINFO_LIKE` (-1) in the open wave, or if a row for `(A.id, userId, 'MISINFO_LIKE')` exists with `status = 'voided'` AND `void_reason = 'interaction_retracted'`, reactivates it to `status = 'eligible'`, `wave_id = openWave.id`, `void_reason = NULL`. If `status IN ('eligible', 'held', 'counted')`, does nothing.
- **`retractLikeEventOnUnlike(tx, userId, originalPostId)`**:
  - Finds any `reputation_events` row for `user_id = userId`, `post_id = originalPostId`, `kind = 'MISINFO_LIKE'`, and `status IN ('eligible', 'held')`.
  - Locks the open wave (`FOR SHARE`), updates the event to `status = 'voided'`, `void_reason = 'interaction_retracted'`, `wave_id = NULL`, and auto-closes any open appeal on that event.
  - If the event has `status = 'counted'`, does nothing.

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

**Pretrained Model (Local Offline Serving)**

| Field | Specification |
|---|---|
| Model ID | `hamzab/roberta-fake-news-classification` (Hugging Face) |
| Architecture | RoBERTa-base (125M parameters), PyTorch + Hugging Face Transformers |
| License | MIT |
| Pinned Revision | `648014ea36ff8aff85b6a6ee25e77579c27bcf19` (SafeTensors format) |
| Label Mapping | `0` = FAKE (`p_fake = softmax(logits)[0]`), `1` = TRUE |
| Input Format | `<title> {title} <content> {content} <end>` (empty title when post has body only) |
| Max Sequence Length | 512 tokens |
| Runtime Environment | CPU inference by default, optional CUDA acceleration; loaded once during startup |
| Offline Guarantee | Weights baked into Docker image during build; zero external API calls at runtime |

**Evaluation (`services/detector/scripts/evaluate_model.py`):** evaluated on the LIAR test split (`ucsbnlp/liar`) without modifying model weights. Measures accuracy, per-class precision, recall, F1, macro-F1, confusion matrix, ROC-AUC, and PR-AUC. Misclassified samples logged to `reports/errors_pretrained.csv`. Reports generated at `reports/detector_eval.md`. Limitations regarding in-domain vs. real-world social media transfer are documented in `MODEL_CARD.md`.

**Threshold selection (`services/detector/scripts/select_thresholds.py`, uses validation split only):** sweep t from 0.50 to 0.95 in steps of 0.01. `fake_high` = smallest t such that precision of class fake among samples with `p_fake >= t` is at least 0.70 and those samples are at least 2 percent of the validation set; if none qualifies, `fake_high = 0.90` (fallback) or provisional default `0.65`. `real_low` = 1 minus the smallest t such that precision of class real among samples with `p_fake <= 1 - t` is at least 0.70 with at least 2 percent coverage; if none qualifies, `real_low = 0.10` (fallback) or provisional default `0.35`. Written to `artifacts/thresholds.json`, `.env.example`, and `docs/DEPLOYMENT.md`.

**Artifacts:** `services/detector/artifacts/model/` (SafeTensors weights and tokenizer config), `artifacts/metadata.json` (`model_name`, `model_version` = `hamzab-roberta-fake-news-classification-<first 8 chars of revision SHA>`, `hf_revision`, `architecture`, `license`, `label_mapping`, `weights_sha256`, metrics, thresholds), `artifacts/thresholds.json`. The container loads the model once at startup; `/healthz` returns 503 until loaded.

### 1.7 API specification (binding - Updated for v2.0)

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

- `packages/shared/src/enums.ts`:
  - `EVENT_KINDS = ['RESPONSIBLE_POST', 'RESPONSIBLE_RESHARE', 'VALID_REPORT', 'MISINFO_POST', 'MISINFO_RESHARE', 'MISINFO_LIKE', 'REVERSAL'] as const`
  - `VOID_REASONS = ['cap_exceeded', 'assessment_superseded', 'interaction_retracted'] as const`
- `UserSummary`: `{id, username, displayName, avatarUrl|null, tier}`.
- `Me`: `{id, username, email, displayName, bio, avatarUrl|null, role, status, emailVerified: boolean, score: {q: string, sigma: string, tier}, createdAt}`. Decimals are strings.
- `Post`: `{id, kind: 'original'|'reshare', author: UserSummary, body, sourceUrl|null, images: [{id, url, width, height}], status, createdAt, editedAt|null, label, underAppeal: boolean, requiresShareConfirmation: boolean, counts: {likes, comments, reshares}, viewer: {liked, reshared}, reshareOf: Post|null (original, one level), authorView?: {detection: {status, band|null}, events: [{kind, value, status}]}, adminView?: {detection: {status, band, pFake, modelName, modelVersion}}}`. `authorView` is present only for the author and admins; `adminView` only for admins.
- `Comment`: `{id, postId, author: UserSummary, body, createdAt}`.
- `LedgerRow`: `{waveNumber, nPos, nNeg, nAdj, r, sigmaUsed, qBefore, delta, qAfter, formulaVersion, finalizedAt}` (decimals as strings).
- `EventItem`: `{id, kind, value, status, waveNumber|null, voidReason|null, post: {id, excerpt}, assessment: {verdict, source, createdAt, rationale}|null, reversesEventId|null, appeal: {id, status}|null, createdAt}`.

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
| DELETE `/users/me` | Auth | `{password}` | 204 | RUL-022, SEC-014 |
| GET `/users/me/export` | Auth | | 200 JSON attachment | Profile, posts, comments, likes (active and retracted), follows, events, ledger, notifications |
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
| GET `/posts/:id` | Pub | | 200 `Post` | Counts active likes only (`deleted_at IS NULL`) |
| PATCH `/posts/:id` | Act | `{body?, sourceUrl?}` | 200 `Post` | RUL-017 else 409 `EDIT_NOT_ALLOWED` |
| DELETE `/posts/:id` | Act | | 204 | Owner only; soft delete (if reshare, triggers retraction) |
| GET `/feed/global` | Pub | cursor | 200 page of `Post` | RUL-031 |
| GET `/feed/following` | Auth | cursor | 200 page of `Post` | Posts and reshares by followed users, plus own |
| POST `/posts/:id/reshare` | Act | `{comment?, acknowledgedWarning?}` | 201 `Post` | RUL-019; syncs `RESPONSIBLE_RESHARE` or `MISINFO_RESHARE` |
| DELETE `/posts/:id/reshare` | Act | | 204 | Soft-deletes caller's reshare; retracts unfinalized event per RUL-019 |
| POST and DELETE `/posts/:id/like` | Act | | 204 | RUL-032; idempotent; syncs/retracts `MISINFO_LIKE` |
| GET `/posts/:id/comments` | Pub | cursor | 200 page of `Comment` (oldest first) | |
| POST `/posts/:id/comments` | Act | `{body (1..300)}` | 201 `Comment` | Comments never generate scoring events (DEC-006) |
| DELETE `/comments/:id` | Act | | 204 | Author or admin |
| POST `/posts/:id/report` | Act | `{reason, details?}` | 201 `{id}` | RUL-020 |
| GET `/me/score` | Auth | | 200 `{q, sigma, tier, currentWave: {number, openedAt, pending: {nPos, nNeg, nAdj, r, projectedDelta}}, thresholds: {trustedMin, lowMax}}` | Uses all 7 event kinds in pending aggregates |
| GET `/me/score/history` | Auth | cursor | 200 page of `LedgerRow` (newest first) | |
| GET `/me/score/history/:waveNumber` | Auth | | 200 `{row: LedgerRow, events: EventItem[]}` | Includes all 7 event kinds |
| GET `/me/events` | Auth | `status?`, cursor | 200 page of `EventItem` | Exposes void reasons |
| POST `/events/:id/appeal` | Act | `{reason (20..1000)}` | 201 `{id, status}` | RUL-016 on negative events (POST, RESHARE, LIKE) |
| GET `/me/appeals` | Auth | cursor | 200 page of `{id, status, reason, resolutionNote, createdAt, resolvedAt}` | |
| GET `/users/:username/score` | Pub | | 200 `{tier, q?}` | RUL-023 |
| GET `/waves/current` | Pub | | 200 `{number, openedAt}` | |
| GET `/notifications` | Auth | `unread?`, cursor | 200 page of `{id, type, actor: UserSummary|null, postId|null, payload, createdAt, readAt}` | |
| GET `/notifications/unread-count` | Auth | | 200 `{count}` | |
| POST `/notifications/read` | Auth | `{ids?: uuid[]}` | 204 | Omit `ids` to mark all |
| GET `/notifications/stream` | Auth | | SSE | Event name `notification`, data = notification JSON; comment heartbeat every 25 s |
| GET `/messages/conversations` | Auth | cursor | 200 page of `{user: UserSummary, lastMessage, unreadCount}` | |
| GET `/messages/with/:username` | Auth | cursor | 200 page of `{id, senderId, body, createdAt, readAt}` (newest first) | |
| POST `/messages/with/:username` | Act | `{body (1..1000)}` | 201 message | Messages never create scoring events (DEC-006) |
| POST `/messages/with/:username/read` | Auth | | 204 | |
| GET `/admin/queue` | Adm | cursor | 200 page of `{post: Post, priority, openReports, reshares, reasons: string[]}` | RUL-013 (includes reported auto_real posts) |
| GET `/admin/posts/:id` | Adm | | 200 `{post, author: {id, username, q, sigma, tier}, detections: [...], reports: [...], assessments: [...], events: [...], appeals: [...]}` | |
| POST `/admin/posts/:id/assessments` | Adm | `{verdict, rationale (10..2000), detectionResultId?}` | 201 `{assessment, eventsCreated: {kind, count}[], eventsVoided, reversalsCreated}` | Rejects with 409 ALREADY_EXISTS only when current verdict matches and source is admin; sends notifications |
| POST `/admin/posts/:id/release` | Adm | | 204 | RUL-024 |
| DELETE `/admin/posts/:id` | Adm | `{reason}` | 204 | Soft delete + audit |
| POST `/admin/posts/:id/redetect` | Adm | | 202 `{detectionId}` | Inserts new queued row |
| POST `/admin/detections/:id/requeue` | Adm | | 202 | Only `failed_permanent`; resets attempts |
| GET `/admin/appeals` | Adm | `status?`, cursor | 200 page | |
| POST `/admin/appeals/:id/resolve` | Adm | `{decision: 'upheld'|'overturned', note (10..1000), newVerdict?: 'real'|'unverifiable', rationale?}` | 200 | Upheld releases held event; overturned supersedes assessment per RUL-015 |
| GET `/admin/waves` | Adm | cursor | 200 page `{id, number, status, openedAt, finalizedAt, usersScored?, eventsCounted?}` | |
| GET `/admin/waves/:id/ledger` | Adm | cursor | 200 page of `LedgerRow & {user: UserSummary}` | |
| POST `/admin/waves/:id/finalize` | Adm | none | 200 `{alreadyFinalized, wave, usersScored, eventsCounted}` | Idempotent |
| POST `/admin/verify-scores` | Adm | none | 200 `{ok, issues}` | |
| GET `/admin/users` | Adm | `q?`, `status?`, cursor | 200 page `{user, q, sigma, tier, role, status}` | |
| GET `/admin/users/:id` | Adm | | 200 user + score history | |
| POST `/admin/users/:id/suspend` and `/unsuspend` | Adm | `{reason}` | 204 | Audit logged; admins cannot suspend admins |
| GET `/admin/audit` | Adm | `entityType?`, `entityId?`, `actorId?`, cursor | 200 page | |
| GET `/admin/analytics/overview` | Adm | | 200 `{users, posts, waves, openQueue, openAppeals, detectionStatusCounts}` | |
| GET `/admin/analytics/detector` | Adm | | 200 `{countsByBand, failureRate, avgLatencyMs, agreement: {adminFakeVsBandLikelyFake, ...}}` | |
| GET `/admin/analytics/waves` | Adm | | 200 per-wave `{number, usersScored, nPos, nNeg, nAdj, sumDelta}` | |
| GET `/admin/analytics/spread` | Adm | | 200 per wave and tier: reshares and likes before and after label time | |
| GET `/admin/export/ledger.csv`, `/events.csv`, `/assessments.csv` | Adm | `waveNumber?` | CSV | Header row, UTF-8, RFC 4180 quoting |
| GET `/admin/detector/status` | Adm | | 200 `{health, modelInfo}` | Proxies detector `/healthz` and `/v1/model-info` |
| GET `/healthz` | Pub | | 200 `{status:'ok'}` | Liveness; outside `/api/v1` |
| GET `/readyz` | Pub | | 200 or 503 `{db, migrations, detector}` | Ready when db ok and all migrations applied |
| GET `/metrics` | Bearer `METRICS_TOKEN` | | Prometheus text | |

**Rate limits** (memory store, keyed by user id when signed in, else IP): global 300 per minute per IP; login 10 per minute per IP; register 5 per hour per IP; forgot-password 5 per hour per IP; `POST /posts` 20 per hour; comments 60 per hour; likes 300 per hour; reshares 60 per hour; reports 30 per hour; media 30 per hour; messages 120 per hour; follows 100 per hour; appeals 5 per day; search 60 per minute.

### 1.8 Frontend specification (binding - Updated for v2.0)

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
| `/admin/queue` | Review queue | Sorted by priority (includes reported auto_real posts) |
| `/admin/posts/:id` | Review workspace | Post, model output, reports, history, decision form with consequences confirmation |
| `/admin/appeals` | Appeals | List and resolve dialog |
| `/admin/waves` | Waves | Current wave, pending event counts, finalize button with confirmation, ledger viewer |
| `/admin/users`, `/admin/users/:id` | Users | Search, suspend, score history |
| `/admin/audit` | Audit log | Filters |
| `/admin/verify` | Verification | Run `verify-scores`, show issues |
| `/admin/analytics` | Analytics | Charts: detector bands, wave totals, spread by tier; CSV export links |

**UI rules and copy (`apps/web/src/copy.ts`)**

- **Labels:** `auto_flagged` shows an amber badge "Automated check: may be misleading (not yet verified)"; `fact_checked_false` shows a red badge "Fact-check: False"; `fact_checked_true` shows a green badge "Fact-check: Verified"; `unverifiable` shows a grey badge "Could not be verified"; `under_appeal` adds the text "Under appeal". `none` shows nothing.
- **Tier badges:** `trusted` "Trusted contributor", `low` "Low credibility (recent verified misinformation)", `neutral` no badge.
- **Event kinds human-readable labels:**
  - `RESPONSIBLE_POST`: "Authored verified post (+1)"
  - `RESPONSIBLE_RESHARE`: "Shared verified post (+1)"
  - `VALID_REPORT`: "Reported false post (+1)"
  - `MISINFO_POST`: "Authored false post (-1)"
  - `MISINFO_RESHARE`: "Shared false post (-1)"
  - `MISINFO_LIKE`: "Liked false post (-1)"
  - `REVERSAL`: "Reversal adjustment (+1 / -1)"
  - `void_reason = 'interaction_retracted'`: "Voided (interaction retracted before wave finalization)"
  - `void_reason = 'cap_exceeded'`: "Voided (per-wave cap exceeded)"
  - `void_reason = 'assessment_superseded'`: "Voided (superseded by new assessment)"
- **Admin Workspace Confirmation Summary (`/admin/posts/:id`):**
  - For verdict `fake`: "Will create -1 for author, -1 for N resharers, -1 for L likers, and +1 for M reporters".
  - For verdict `real`: "Will create +1 for author and +1 for N resharers".
- **Author-only detection text:** queued or running "Automated check pending"; ok and `likely_real` "Automated check: no concerns"; ok and `uncertain` "Automated check: inconclusive, sent for review"; ok and `likely_fake` "Automated check flagged this post, sent for review"; failed or `failed_permanent` "Automated check unavailable, sent for review".
- **Reshare confirmation dialog:** appears when `requiresShareConfirmation` is true (prompt: "This post was flagged or has been fact-checked as false. Sharing it may reduce your credibility score. Share anyway?").
- **Score explanation drawer:** displays formula with actual numbers (`Q(w+1) = Q(w) + sigma x R(w)`), table of counted events, and arithmetic line `R = n+ - n- + adjustments`.

### 1.9 Configuration specification (binding - Updated for v2.0)

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
| `RESHARE_PENALTY_ENABLED` | `true` | Enables `MISINFO_RESHARE` (-1) |
| `LIKE_PENALTY_ENABLED` | `true` | Enables `MISINFO_LIKE` (-1) on admin fake assessments and likes on fake posts (DEC-001) |
| `RESPONSIBLE_RESHARE_REWARD_ENABLED` | `true` | Enables `RESPONSIBLE_RESHARE` (+1) on admin real assessments and verified reshares (DEC-003) |
| `MAX_RESPONSIBLE_POST_EVENTS_PER_WAVE` | `5` | Cap on `RESPONSIBLE_POST` per wave |
| `MAX_RESPONSIBLE_RESHARE_EVENTS_PER_WAVE` | `5` | Per-user, per-wave cap for non-voided `RESPONSIBLE_RESHARE` events (RUL-005, DEC-003) |
| `MAX_VALID_REPORT_EVENTS_PER_WAVE` | `5` | Cap on `VALID_REPORT` per wave |
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

### 1.10 Core Requirements & Constraints List

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

---

## 2. Implementation Steps

Execution rules: complete tasks in numeric order within a phase; a phase may start only when the phases it depends on are complete (Section 4). Each task ends with its tests passing and one commit (GUD-004, GUD-005). Mark `Completed` with a check mark and the date when done.

### Implementation Phase 1: Foundation and tooling

- GOAL-001: A runnable monorepo with local infrastructure (PostgreSQL, MinIO, Mailpit), CI, shared enums/schemas, and an API and web skeleton.
- **Audit Findings & Policy Decisions Resolved:** Foundation for DEC-001, DEC-003, DEC-005 (shared enums for 7 event kinds and 3 void reasons, plus config toggles).
- **Relevant Files & Schema Objects:** `package.json`, `packages/shared/src/enums.ts`, `apps/api/src/config.ts`, `.env.example`, `docker-compose.yml`.
- **Dependencies:** None (first phase).
- **Edge Cases & Failure Handling:** Invalid or out-of-range environment variables (`MAX_RESPONSIBLE_RESHARE_EVENTS_PER_WAVE < 0`, invalid `SIGMA_DEFAULT`) fail fast at process startup (REQ-036).
- **Acceptance Criteria:** `docker compose up -d` starts healthy containers; `npm run lint`, `npm run typecheck`, and Phase 1 unit tests pass.

| Task | Description | Completed | Date |
|---|---|---|---|
| TASK-001 | Initialize git. Create root `package.json` (private, workspaces `apps/*`, `packages/*`, `tools/*`), `.nvmrc`, `.gitignore` (node_modules, dist, coverage, `.env`, `__pycache__`, `services/detector/data/`), `.editorconfig`, `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`, ES2022), ESLint flat config with typescript-eslint, Prettier config. Root scripts: `lint`, `typecheck`, `test`, `build`, `db:migrate`, `db:migrate:test`. | [x] | 2026-10-31 |
| TASK-002 | Create `packages/shared` (`@app/shared`): `src/enums.ts` exporting const arrays and Zod enums for every enum in Section 1.4, including all 7 `EVENT_KINDS` (`RESPONSIBLE_POST`, `RESPONSIBLE_RESHARE`, `VALID_REPORT`, `MISINFO_POST`, `MISINFO_RESHARE`, `MISINFO_LIKE`, `REVERSAL`) and 3 `VOID_REASONS` (`cap_exceeded`, `assessment_superseded`, `interaction_retracted`), plus `src/index.ts`. Build with `tsc` to `dist`. | [x] | 2026-10-31 |
| TASK-003 | Create `docker-compose.yml` with `postgres` (postgres:16, volume, healthcheck, databases `app` and `app_test` via `scripts/init-test-db.sql`), `minio` plus an init container that creates bucket `app-media` with anonymous download enabled, and `mailpit` (SMTP 1025, UI 8025). Verify `docker compose up -d` reports all services healthy. | [x] | 2026-10-31 |
| TASK-004 | Create `.env.example` listing every variable in Section 1.9 (including `LIKE_PENALTY_ENABLED=true`, `RESPONSIBLE_RESHARE_REWARD_ENABLED=true`, `MAX_RESPONSIBLE_RESHARE_EVENTS_PER_WAVE=5`) with its default and a one-line comment; local values for MinIO (`S3_ENDPOINT=http://localhost:9000`, `S3_FORCE_PATH_STYLE=true`) and Mailpit (`SMTP_HOST=localhost`, `SMTP_PORT=1025`). | [x] | 2026-10-31 |
| TASK-005 | Create `apps/api` skeleton: `src/config.ts` (Zod-validated, REQ-036, including v2.0 scoring toggles and caps), `src/logger.ts` (pino with redaction of `authorization`, `cookie`, `password`, `token`), `src/app.ts` (app factory: request id, pino-http, JSON body limit 100 kb, error handler producing the envelope, 404 handler), `src/index.ts` (listen, graceful shutdown per REQ-037), `src/modules/health/routes.ts` (`GET /healthz`). Tests: `/healthz` returns 200; unknown route returns envelope `NOT_FOUND`; invalid config exits with a readable error. | [x] | 2026-10-31 |
| TASK-006 | Create `apps/web` (Vite, React, TypeScript, Tailwind, React Router, TanStack Query): `src/main.tsx`, `src/App.tsx`, `src/copy.ts`, `src/api/client.ts` (fetch wrapper with `credentials: 'include'`, JSON handling, error envelope parsed into an `ApiError` class). Vite dev proxy: `/api` and `/healthz` to `http://localhost:3000`, `/ws` as WebSocket proxy. Test: Vitest renders `App`. | [x] | 2026-10-31 |
| TASK-007 | Create `.github/workflows/ci.yml` with jobs `lint-typecheck`, `api-tests` (service containers postgres:16, minio, mailpit), `web-tests`, `detector-tests` (placeholder step list completed in TASK-035), `audit` (`npm audit --audit-level=high`, `pip-audit`). Later tasks append steps. | [x] | 2026-10-31 |
| TASK-008 | Create test infrastructure in `apps/api/test/setup/`: Vitest config (`pool: 'forks'`, `fileParallelism: false`), `globalSetup.ts` running migrations on `app_test`, `db.ts` with `truncateAll()` (TRUNCATE every table with CASCADE, then insert open wave 1), `factories.ts` that create users, posts and events through the real service layer or SQL. Test: after `truncateAll()` exactly one wave exists and it is open with number 1. | [x] | 2026-10-31 |
| TASK-009 | Create `docs/DECISIONS.md` (table: id, task, decision, reason — pre-populated with DEC-001 through DEC-006) and root `README.md` skeleton (purpose, prerequisites, `docker compose up -d`, `npm ci`, migrate, run). | [x] | 2026-10-31 |

### Implementation Phase 2: Database

- GOAL-002: The schema of Section 1.4 exists exactly, with all invariants, triggers, soft-delete audit columns on likes, updated reputation_events constraints, and the fixed review_queue_v view enforced by PostgreSQL 16 and proven by tests.
- **Audit Findings & Policy Decisions Resolved:**
  - DEC-001 & Audit Gap 1 (`likes` soft deletion `deleted_at`/`updated_at`, `likes_target_original_trg` trigger, `MISINFO_LIKE` in `reputation_events`).
  - DEC-003 & Audit Gap 2 (`RESPONSIBLE_RESHARE` in `reputation_events`, `reshare_post_id` FK).
  - DEC-005 & Audit Gap 7 (`void_reason` check constraint including `'interaction_retracted'`, `wave_id IS NULL` when `status IN ('held', 'voided')`, `events_guard_trg` protecting counted events while allowing eligible/held transitions to voided).
  - Audit Gap 4 (`review_queue_v` in `0005_search_and_views.sql` includes `auto_real` posts when `open_reports > 0`).
- **Relevant Files & Schema Objects:** `apps/api/src/db/migrations/0001_core_identity.sql` through `0005_search_and_views.sql`, `apps/api/test/db/constraints.test.ts`, `apps/api/test/db/enum-parity.test.ts`.
- **Dependencies:** Depends on Phase 1.
- **Edge Cases & Failure Handling:** Attempting to like a reshare post fails with 23514 `check_violation`; attempting to modify a counted event or finalized ledger row fails with `events_guard` / `ledger_guard` exception; attempting to insert two non-reversal events of the same `(assessment_id, user_id, kind)` fails with 23505 `unique_violation`.
- **Acceptance Criteria:** All migrations run cleanly; `constraints.test.ts` (TEST-103) and `enum-parity.test.ts` (TEST-104) pass 100%.

| Task | Description | Completed | Date |
|---|---|---|---|
| TASK-010 | Configure `node-pg-migrate` (SQL migrations in `apps/api/src/db/migrations/`, connection from `DATABASE_URL_DIRECT`). Implement `src/db/pool.ts` (pg Pool, `max = DATABASE_POOL_MAX`, `statement_timeout` 10 s, `application_name`) and `src/db/tx.ts` (`withTransaction(fn)` per PAT-002). Tests: transaction commits on success and rolls back on throw; the client is released in both cases. | [x] | 2026-10-31 |
| TASK-011 | Write `0001_core_identity.sql` containing exactly the 0001 DDL of Section 1.4 (`users`, `users_guard_trg`, `sessions`, `email_tokens`, `email_outbox`, `media`). | [x] | 2026-10-31 |
| TASK-012 | Write `0002_posts_detection.sql` containing exactly the 0002 DDL (`posts`, `posts_reshare_target_trg`, `post_revisions`, `post_media`, `detection_results`). | [x] | 2026-10-31 |
| TASK-013 | Write `0003_governance_scoring.sql` containing the updated v2.0 0003 DDL of Section 1.4 (`waves`, `reports`, `assessments`, `assessments_guard_trg`, `user_wave_reputation`, `reputation_events` with all 7 kinds and `void_reason` check, `events_guard_trg`, `ledger_guard_trg`, `appeals` with `resolved_by_system`, `admin_audit_log`). | [x] | 2026-10-31 |
| TASK-014 | Write `0004_social.sql` containing the updated v2.0 0004 DDL of Section 1.4 (`comments`, `likes` with `updated_at`, `deleted_at`, and `likes_target_original_trg`, `follows`, `blocks`, `notifications`, `messages`). | [x] | 2026-10-31 |
| TASK-015 | Write `0005_search_and_views.sql` containing the updated v2.0 0005 DDL of Section 1.4 (including the fixed `review_queue_v` view that admits reported `auto_real` posts). Run all migrations on `app` and `app_test` and confirm a clean second run applies nothing. | [x] | 2026-10-31 |
| TASK-016 | Implement `scripts/create-user.ts` (`--username --email --password --display-name [--sigma 0..1] [--admin]`, sets `email_verified_at = now()`, hashes with argon2id per SEC-001) and `scripts/create-admin.ts`. Both reuse `createUser` in `apps/api/src/modules/users/service.ts`. Tests: created admin has requested sigma; sigma outside [0,1] is rejected. | [x] | 2026-10-31 |
| TASK-017 | Write `apps/api/test/db/constraints.test.ts` (TEST-103) proving every DB invariant: sigma immutability; q update blocked without `app.scoring`; single open wave; ledger CHECKs and immutability; counted event immutability; eligible event transition to voided (`interaction_retracted`) and reactivation back to eligible succeeds while counted event transition to voided fails; `RESPONSIBLE_RESHARE` requires +1 and `MISINFO_LIKE` requires -1; liking a reshare post fails via `likes_target_original_trg`; `review_queue_v` includes an `auto_real`-assessed post as soon as an open report is inserted and excludes an admin-assessed post even with open reports. | [x] | 2026-10-31 |
| TASK-018 | Write `apps/api/test/db/enum-parity.test.ts` (TEST-104) that parses the CHECK lists from the migration SQL text (including the 7 `reputation_events.kind` values and 3 `void_reason` values) and asserts they equal the arrays exported by `packages/shared/src/enums.ts`. | [x] | 2026-10-31 |
| TASK-019 | Implement `src/db/cursor.ts` (`encodeCursor(createdAt, id)`, `decodeCursor`, rejects malformed cursors with `VALIDATION_ERROR`) and `src/db/errors.ts` (maps pg error codes 23505 to `CONFLICT`, 23503 to `CONFLICT`, 23514 to `VALIDATION_ERROR`, 57014 to `UNAVAILABLE`). Unit tests for round trip and malformed input. | [x] | 2026-10-31 |

### Implementation Phase 3: Scoring engine

- GOAL-003: The paper's Equation 1 and Equation 2 are implemented once, with full support for all 7 event kinds, interaction retractions before wave finalization, Good-Faith Window protection on overturned verdicts, historical reporter rewards on superseded assessments, idempotent finalization, and invariant verification (I1–I6).
- **Audit Findings & Policy Decisions Resolved:**
  - DEC-001 & Audit Gap 1: `MISINFO_LIKE` (-1) generation on assessment (`createEventsForAssessment`), immediate creation/reactivation on like (`syncLikeEventOnLike`), retraction before wave finalization (`retractLikeEventOnUnlike`), and aggregation into `n_neg` in `finalizeWave.ts`.
  - DEC-002 & Audit Gap 3: Pure scoring functions (`pure.ts`) and event creation (`events.ts`) use flat unit values (+1 / -1) and user sigma only; zero publisher-reputation weighting.
  - DEC-003 & Audit Gap 2: `RESPONSIBLE_RESHARE` (+1) generation on admin real assessment and post-assessment reshare (`syncReshareEventOnCreate`), per-wave cap (`MAX_RESPONSIBLE_RESHARE_EVENTS_PER_WAVE`), and aggregation into `n_pos` in `finalizeWave.ts`.
  - DEC-004 & Audit Gap 3: Author receives flat -1 (`MISINFO_POST`) regardless of likes/reshares count.
  - DEC-005 & Audit Gap 7: `retractReshareEventOnDelete` and `retractLikeEventOnUnlike` void eligible/held events (`void_reason = 'interaction_retracted'`), refuse to touch counted events, and allow clean reactivation on re-share/re-like without 23505 errors.
  - Audit Gap 5: `createEventsForAssessment` awards `VALID_REPORT` (+1) to reporters whose reports were previously marked resolved by a superseded real/unverifiable assessment when the post is later assessed as fake.
  - Audit Gap 6: `createEventsForAssessment` computes Good-Faith Windows (periods when an admin real assessment was current) and exempts reshares and likes created during those windows from retroactive `MISINFO_RESHARE` and `MISINFO_LIKE` penalties if the post is later reassessed as fake.
- **Relevant Files, Functions & Rules:** `apps/api/src/scoring/pure.ts`, `events.ts`, `finalizeWave.ts`, `verify.ts`, `corrections.ts`, `apps/api/src/jobs/waveScheduler.ts`, Rules RUL-001–RUL-010, RUL-015, RUL-019, RUL-032.
- **Dependencies:** Depends on Phase 1 and Phase 2.
- **Edge Cases & Failure Handling:** Author likes or reshares their own post: `user_id <> post.author_id` filter prevents self-reward and self-penalty; liking and resharing the same false post receives two distinct -1 penalties; retraction during finalization serializes via row locks.
- **Acceptance Criteria:** 100% line and branch coverage on `apps/api/src/scoring` (REQ-018); all unit and integration tests (TEST-001–TEST-035) pass.

| Task | Description | Completed | Date |
|---|---|---|---|
| TASK-020 | Implement `apps/api/src/scoring/pure.ts` (`computeR`, `applyUpdate`, `foldHistory`, `decomposedScore`, `verifyUserHistory` per Section 1.5). Implement unit tests TEST-001 through TEST-012 in `apps/api/test/scoring/pure.test.ts`. | [x] | 2026-10-31 |
| TASK-021 | Implement `apps/api/src/scoring/events.ts`: `createEventsForAssessment(tx, assessment)`, `syncReshareEventOnCreate(tx, reshare)`, `retractReshareEventOnDelete(tx, userId, originalPostId)`, `syncLikeEventOnLike(tx, userId, originalPostId)`, and `retractLikeEventOnUnlike(tx, userId, originalPostId)` implementing RUL-002–RUL-005, RUL-007, RUL-015 (Good-Faith Window exemption and historical reporter lookup), RUL-019, and RUL-032. Lock the open wave with `FOR SHARE`. | [x] | 2026-10-31 |
| TASK-022 | Implement `apps/api/src/scoring/finalizeWave.ts` per Section 1.5 (aggregating `RESPONSIBLE_POST`, `RESPONSIBLE_RESHARE`, `VALID_REPORT` into `n_pos` and `MISINFO_POST`, `MISINFO_RESHARE`, `MISINFO_LIKE` into `n_neg`), returning `{alreadyFinalized, wave, usersScored, eventsCounted}`. | [x] | 2026-10-31 |
| TASK-023 | Implement `apps/api/src/scoring/verify.ts` (`verifyScores()` implementing I1 to I6 with the 7 event kinds) and `scripts/verify-scores.ts` (prints issues, exit code 1 on any issue). | [x] | 2026-10-31 |
| TASK-024 | Implement `apps/api/src/scoring/corrections.ts`: `supersedeAssessment(tx, oldAssessment, newAssessmentInput)` implementing RUL-015 (set `is_current = false`, insert successor, void eligible and held events with `assessment_superseded` and close open appeals on them, insert `REVERSAL` events for counted events—including `MISINFO_LIKE` and `RESPONSIBLE_RESHARE`—then call `createEventsForAssessment`). | [x] | 2026-10-31 |
| TASK-025 | Implement `apps/api/src/jobs/waveScheduler.ts`: every 60 s, under `pg_try_advisory_xact_lock`, if `WAVE_AUTO_FINALIZE_INTERVAL_HOURS > 0` and the open wave is older than the interval, call `finalizeWave` with actor `{kind:'system'}`. Register the loop in `src/jobs/index.ts`. | [x] | 2026-10-31 |
| TASK-026 | Integration tests `apps/api/test/scoring/finalize.test.ts`: TEST-013 through TEST-020 (all numerical cases through the real database including `MISINFO_LIKE` and `RESPONSIBLE_RESHARE`, idempotent double finalize, 10 parallel finalize calls, bystander rows, sigma immutability, `q = sigma * sum(r)`). | [x] | 2026-10-31 |
| TASK-027 | Integration tests `apps/api/test/scoring/corrections.test.ts`: TEST-021 through TEST-035 covering: reversal of counted events (author, resharer, liker, reporter); voiding before finalization; Good-Faith Window protection when real (admin) is superseded by fake (TEST-027); historical reporter receiving `VALID_REPORT` when unverifiable or `auto_real` is superseded by fake (TEST-028); like/unlike retraction before and after wave finalization (TEST-029, TEST-030); reshare retraction before and after wave finalization (TEST-031, TEST-032); repeated reshare and repeated like reactivation without 23505 errors (TEST-033); flat -1 publisher penalty invariant across 0 vs. 50 likes/reshares and across trusted/neutral/low publisher tiers (TEST-034, TEST-035). | [x] | 2026-10-31 |

### Implementation Phase 4: Detector (pretrained model)

- GOAL-004: A containerized detector service hosting the pretrained RoBERTa fake-news model (`hamzab/roberta-fake-news-classification`) that implements the contract of Section 1.6 with local inference, zero external paid APIs, and honest empirical evaluation.
- **Audit Findings & Policy Decisions Resolved:** Preserves separation between automated detection (`p_fake` -> bands) and human-reviewed scoring (RUL-001, RUL-002, REQ-008, REQ-009). No training from scratch; model loaded locally once at startup.
- **Relevant Files:** `services/detector/**`, `docs/DATASETS.md`, `docs/DEPLOYMENT.md`.
- **Dependencies:** Depends on Phase 1.
- **Edge Cases & Failure Handling:** Missing/wrong `X-Detector-Key` returns 401; text out of 1..2000 chars returns 422; unready model returns 503; inference errors return 500; invalid probabilities rejected.
- **Acceptance Criteria:** pytest, ruff, and mypy pass (TEST-100); local pretrained SafeTensors weights verified; `MODEL_CARD.md`, `metadata.json`, and `thresholds.json` generated.

| Task | Description | Completed | Date |
|---|---|---|---|
| TASK-028 | Scaffold `services/detector`: `pyproject.toml`, `requirements.txt`, `requirements-train.txt`. Implement `app/preprocess.py` (NFKC, URLs, mentions, whitespace) and `tests/test_preprocess.py`. | [x] | 2026-11-02 |
| TASK-029 | Implement `scripts/download_model.py` for pretrained `hamzab/roberta-fake-news-classification` (revision `648014ea36ff8aff85b6a6ee25e77579c27bcf19`), verify label mapping (0=FAKE, 1=TRUE), author `docs/DATASETS.md`. | [x] | 2026-11-02 |
| TASK-030 | Implement model loading and inference in `app/model.py` (single-load startup, CPU default with CUDA support, `<title> <content> <end>` format, softmax p_fake extraction), generate `artifacts/metadata.json`. | [x] | 2026-11-02 |
| TASK-031 | Implement offline evaluation pipeline in `scripts/evaluate_model.py` on benchmark dataset without retraining or modifying model weights. | [x] | 2026-11-02 |
| TASK-032 | Execute evaluation of pretrained model, produce `reports/detector_eval.md` honestly documenting methodology and dataset availability limitations. | [x] | 2026-11-02 |
| TASK-033 | Document pretrained model architecture, verification, limitations, provenance, and risks in `services/detector/MODEL_CARD.md` and `artifacts/metadata.json`. | [x] | 2026-11-02 |
| TASK-034 | Implement FastAPI service: `app/main.py`, `app/schemas.py`, `app/config.py`, `services/detector/Dockerfile` (baking weights for offline runtime), and update `docker-compose.yml`. | [x] | 2026-11-02 |
| TASK-035 | Write `services/detector/tests/test_api.py` (TEST-100 covering 16 criteria: auth, validation, schema, error envelopes, healthcheck, model-info, latency) and pass all 24 tests. | [x] | 2026-11-02 |
| TASK-036 | Implement `scripts/select_thresholds.py`, write `artifacts/thresholds.json` with provisional values and selection rationale, update `.env.example` and `docs/DEPLOYMENT.md`. | [x] | 2026-11-02 |

### Implementation Phase 5: Backend core

- GOAL-005: Authentication, users, media, notifications core, posts, feeds, and score read endpoints, all with real services.
- **Audit Findings & Policy Decisions Resolved:** Score read endpoints (`GET /me/score`, `/me/score/history/:waveNumber`, `/me/events`) and post serializer (`serializePost`) accurately count active likes (`WHERE deleted_at IS NULL`) and expose `MISINFO_LIKE`, `RESPONSIBLE_RESHARE`, and void reasons (`interaction_retracted`) (DEC-001, DEC-003, DEC-005).
- **Relevant Files & Rules:** `apps/api/src/middleware/*`, `apps/api/src/modules/{auth,email,users,media,notifications,posts,feed,score}/*`, RUL-009, RUL-017, RUL-018, RUL-022, RUL-023.
- **Dependencies:** Depends on Phase 2 and Phase 3.
- **Edge Cases & Failure Handling:** `serializePost` counts only active likes (`deleted_at IS NULL`) and non-deleted reshares (`status <> 'deleted'`), and sets `viewer.liked = true` only when the viewer's likes row has `deleted_at IS NULL`.
- **Acceptance Criteria:** TEST-040–TEST-047 and TEST-105 (`authz-matrix.test.ts`) pass.

| Task | Description | Completed | Date |
|---|---|---|---|
| TASK-037 | Implement middleware in `apps/api/src/middleware/`: `originCheck.ts`, `security.ts`, `rateLimit.ts`, `validate.ts`, `auth.ts`, `errors.ts`. Tests for each middleware. | [x] | 2026-10-31 |
| TASK-038 | Implement `modules/auth` (register, login, logout, me) and Zod schemas in `packages/shared/src/schemas/auth.ts`. Tests TEST-040–TEST-045. | [x] | 2026-10-31 |
| TASK-039 | Implement `modules/email` (`enqueueEmail`, outbox loop) and token flows in `modules/auth` (verify-email, resend-verification, forgot-password, reset-password, change-password, sessions). Tests TEST-046–TEST-047. | [x] | 2026-10-31 |
| TASK-040 | Implement `modules/users` (`GET /users/:username`, `PATCH /users/me`). Tests for forbidden fields and q visibility (RUL-023). | [x] | 2026-10-31 |
| TASK-041 | Implement `modules/media`, `src/storage/s3.ts`, and `jobs/mediaCleanup.ts`. Tests against real MinIO. | [x] | 2026-10-31 |
| TASK-042 | Implement `modules/notifications` core (`createNotification`, `bus.ts`, `sse.ts`, routes). Tests over real SSE. | [x] | 2026-10-31 |
| TASK-043 | Implement `modules/posts` (create, get, edit, delete, user posts, `serializePost` counting only active likes `deleted_at IS NULL` and exposing all 7 event kinds in `authorView.events`). | [x] | 2026-10-31 |
| TASK-044 | Implement `modules/feed` (`GET /feed/global`, `GET /feed/following`) with keyset pagination and block filtering. | [x] | 2026-10-31 |
| TASK-045 | Implement `modules/score` routes (`GET /me/score` pending aggregate using all 7 event kinds, `/me/score/history`, `/me/score/history/:waveNumber`, `/me/events`, `/users/:username/score`, `/waves/current`). | [x] | 2026-10-31 |
| TASK-046 | Implement `DELETE /users/me` (RUL-022, SEC-014) and `GET /users/me/export` (including active and retracted likes, events, ledger). | [x] | 2026-10-31 |
| TASK-047 | Write integration tests `apps/api/test/api/authz-matrix.test.ts` (TEST-105) covering every Phase 5 endpoint across all user states. | [x] | 2026-10-31 |

### Implementation Phase 6: Detection integration

- GOAL-006: Posts are scored by the real detector asynchronously, failures are handled safely, and nothing derived from a prediction can penalize a user.
- **Audit Findings & Policy Decisions Resolved:** Enforces RUL-001 and REQ-009 (predictions never create reputation events).
- **Relevant Files:** `apps/api/src/detection/{client,bands,worker,effects}.ts`, `tools/fault-server/server.ts`.
- **Dependencies:** Depends on Phase 4 and Phase 5.
- **Edge Cases & Failure Handling:** Timeouts, HTTP 500/401, malformed JSON, and out-of-range `p_fake` transition rows to `failed` / `failed_permanent` with exponential backoff and zero events created.
- **Acceptance Criteria:** TEST-101 (`failures.test.ts`) and TEST-102 (`real-detector.test.ts`) pass.

| Task | Description | Completed | Date |
|---|---|---|---|
| TASK-048 | Implement `src/detection/client.ts` and `src/detection/bands.ts` (RUL-027). Unit tests for error codes and band boundaries. | [x] | 2026-10-31 |
| TASK-049 | Implement `src/detection/worker.ts` (RUL-026) with `FOR UPDATE SKIP LOCKED`, warm-up, backoff, and stale-running reset. | [x] | 2026-11-03 |
| TASK-050 | Implement `src/detection/effects.ts` (`post_flagged` notification on `likely_fake`; assert zero assessments/events created per REQ-009). | [x] | 2026-11-03 |
| TASK-051 | Implement admin detection endpoints (`POST /admin/posts/:id/redetect`, `POST /admin/detections/:id/requeue`, `GET /admin/detector/status`) and `GET /readyz`. | [x] | 2026-11-03 |
| TASK-052 | Implement `tools/fault-server/server.ts` and `apps/api/test/detection/failures.test.ts` (TEST-101). | [x] | 2026-11-03 |
| TASK-053 | Write `apps/api/test/detection/real-detector.test.ts` (TEST-102) against the real detector container and wire into CI. | [x] | 2026-11-03 |

Verification (2026-11-03): local tests exercise PostgreSQL, real pretrained
inference, original/edited revision persistence, after-commit notifications,
zero prediction-derived scoring events, and a dedicated detector container
stop/start with successful retry. Fault tests cover all seven client error
codes, warm-up failure, retry exhaustion, backoff, stale claims, and row-lock
contention. CI is wired to these tests; a hosted GitHub Actions run is not yet
verified. Independent dataset evaluation and later governance/UI tasks remain
separate outstanding work.

### Implementation Phase 7: Governance (reports, assessments, appeals, admin)

- GOAL-007: Human-reviewed assessments are the only route to negative events, `RESPONSIBLE_RESHARE`, and `VALID_REPORT` events, with full support for superseding `auto_real` assessments when reported, Good-Faith Window protection, historical reporter rewards, and appeals on `MISINFO_POST`, `MISINFO_RESHARE`, and `MISINFO_LIKE`.
- **Audit Findings & Policy Decisions Resolved:**
  - DEC-001 & Audit Gap 1: Admin fake assessment creates `MISINFO_LIKE` (-1) for active likers, notifies them (`assessment_decided`), and allows them to appeal (`POST /events/:id/appeal` per RUL-016).
  - DEC-003 & Audit Gap 2: Admin real assessment creates `RESPONSIBLE_RESHARE` (+1) for active resharers (`auto_real` does not). Admin can also assess an `auto_real` post as real to upgrade it to `fact_checked_true` and reward resharers.
  - Audit Gap 4: Reported `auto_real` posts appear in `GET /admin/queue` with reason `'reported'` and can be assessed by an admin (superseding the `auto_real` assessment via `supersedeAssessment`).
  - Audit Gap 5: When an admin supersedes an `auto_real`, real, or unverifiable assessment with fake, reporters who reported the post before the fake assessment receive `VALID_REPORT` (+1) even if their report was marked resolved by the earlier assessment.
  - Audit Gap 6: When an admin overturns/supersedes an admin real assessment to fake, resharers and likers who interacted during the Good-Faith Window are not penalized.
- **Relevant Files & Functions:** `apps/api/src/modules/governance/{reports,assessments,appeals}.ts`, `apps/api/src/modules/admin/*`, `apps/api/src/jobs/autoReal.ts`.
- **Dependencies:** Depends on Phase 3, Phase 5, and Phase 6.
- **Edge Cases & Failure Handling:** Conflict of interest (RUL-021) enforced for authors, resharers, reporters, and likers (403 `CONFLICT_OF_INTEREST`); duplicate verdict check allows `auto_real` -> admin real upgrade while rejecting identical admin verdicts with 409 `ALREADY_EXISTS`.
- **Acceptance Criteria:** TEST-050–TEST-069 in `apps/api/test/governance/rules.test.ts` pass.

| Task | Description | Completed | Date |
|---|---|---|---|
| TASK-054 | Implement `modules/governance/reports`: `POST /posts/:id/report` per RUL-020. Tests for own-post rejection (403), duplicate (409), deleted post (404), and entry into `review_queue_v` (both when unassessed and when currently `auto_real`). | [x] | 2026-11-03 |
| TASK-055 | Implement `modules/governance/assessments` and `POST /admin/posts/:id/assessments`: locks post row, enforces RUL-021 (author, resharer, reporter, or liker conflict of interest), rejects identical admin verdict with 409 `ALREADY_EXISTS` (while permitting `auto_real` -> admin real), calls `supersedeAssessment` or inserts first assessment, calls `createEventsForAssessment`, writes audit row, and creates notifications (`assessment_decided` for author, resharers, and penalized likers; `report_resolved` for reporters). | [x] | 2026-11-03 |
| TASK-056 | Implement `src/jobs/autoReal.ts` per RUL-014 (creates `RESPONSIBLE_POST` only, never `RESPONSIBLE_RESHARE`). Tests: each condition of RUL-014 blocks auto-real; later user report puts the `auto_real` post into `GET /admin/queue`. | [x] | 2026-11-03 |
| TASK-057 | Implement `modules/governance/appeals`: `POST /events/:id/appeal` (RUL-016: any non-voided negative event—`MISINFO_POST`, `MISINFO_RESHARE`, or `MISINFO_LIKE`—owned by caller within `APPEAL_WINDOW_DAYS`; sets eligible event to held with `wave_id = NULL`), `GET /me/appeals`, `appeal_opened` notification to admins. | [x] | 2026-11-03 |
| TASK-058 | Implement admin appeal endpoints (`GET /admin/appeals`, `POST /admin/appeals/:id/resolve`): `upheld` releases held event to open wave (RUL-008); `overturned` requires `newVerdict` (real or unverifiable) and rationale, calls `supersedeAssessment`, records `new_assessment_id`; enforces RUL-021. | [x] | 2026-11-03 |
| TASK-059 | Implement remaining admin endpoints in `modules/admin`: `GET /admin/queue` (reads `review_queue_v`), `GET /admin/posts/:id` (includes likes, reshares, reports, assessments, events, appeals), `POST /admin/posts/:id/release`, `DELETE /admin/posts/:id`, `GET /admin/users`, `GET /admin/users/:id`, `POST /admin/users/:id/suspend` and `/unsuspend`, `GET /admin/audit`, `GET /admin/waves`, `GET /admin/waves/:id/ledger`, `POST /admin/waves/:id/finalize`, `POST /admin/verify-scores`. | [x] | 2026-11-03 |
| TASK-060 | Write `apps/api/test/governance/rules.test.ts` covering TEST-050 through TEST-069 (including `MISINFO_LIKE` creation and appeal, `RESPONSIBLE_RESHARE` creation and cap, `auto_real` report escalation to queue and admin override, historical reporter `VALID_REPORT` recovery on supersede, Good-Faith Window protection on real -> fake overturn). | [x] | 2026-11-03 |

Verification (2026-11-03): 57 governance and appeal tests pass against real
PostgreSQL. Coverage includes all negative event kinds, ownership and appeal
windows, held-event release, counted-event immutability, overturned assessment
cascades, peer appeal closure, admin conflict checks, cursor pagination with
equal timestamps, after-commit notifications, audit rows, duplicate requests,
and concurrent wave rollover. TASK-059 admin inventory, user, wave, audit,
and score-verification endpoints pass six additional real-database tests.

### Implementation Phase 8: Social features

- GOAL-008: Likes (with soft-delete retraction and `MISINFO_LIKE` lifecycle hooks), comments (excluded from scoring per DEC-006), follows, blocks, reshares (with `RESPONSIBLE_RESHARE` / `MISINFO_RESHARE` creation and retraction hooks), search, and suggestions.
- **Audit Findings & Policy Decisions Resolved:**
  - DEC-001 & Audit Gap 1: `POST /posts/:id/like` and `DELETE /posts/:id/like` in `modules/social/likes.ts` implement soft deletion (`deleted_at`), call `syncLikeEventOnLike` and `retractLikeEventOnUnlike` in the same transaction, and reject liking a reshare directly (400 `VALIDATION_ERROR`).
  - DEC-003 & Audit Gap 2: `POST /posts/:id/reshare` calls `syncReshareEventOnCreate` to award `RESPONSIBLE_RESHARE` (+1) if the original post is currently admin-assessed real (or `MISINFO_RESHARE` (-1) if fake).
  - DEC-005 & Audit Gap 7: `DELETE /posts/:id/reshare` (and `DELETE /posts/:id` when `:id` is a reshare) calls `retractReshareEventOnDelete` in the same transaction to void an eligible/held reshare event (`interaction_retracted`) before wave finalization while leaving counted events untouched, and handles repeated reshare/like cleanly without 23505 errors.
  - DEC-006: `modules/social/comments.ts` creates/deletes comments with zero calls to the scoring engine.
- **Relevant Files & Functions:** `apps/api/src/modules/social/{likes,comments,follows,blocks,reshares,suggestions}.ts`, `apps/api/src/modules/posts/service.ts` (`deletePost` when `post.kind === 'reshare'`), `apps/api/src/modules/search/*`.
- **Dependencies:** Depends on Phase 3, Phase 5, and Phase 7.
- **Edge Cases & Failure Handling:** Rapid like/unlike concurrency serializes via `ON CONFLICT` row locks; like notification sent only on initial like; deleting reshares via both routes maps to the same retraction service.
- **Acceptance Criteria:** TEST-070–TEST-079 in `apps/api/test/social/flows.test.ts` pass.

| Task | Description | Completed | Date |
|---|---|---|---|
| TASK-061 | Implement `modules/social/likes` (RUL-032: soft-delete `deleted_at`, calls `syncLikeEventOnLike` on like and `retractLikeEventOnUnlike` on unlike inside `withTransaction`, rejects non-original target posts with 400, creates like notification only on initial like) and `modules/social/comments` (DEC-006: create and soft delete, zero scoring events). | [x] | 2026-11-03 |
| TASK-062 | Implement `modules/social/follows` and `modules/social/blocks` (RUL-028). | [x] | 2026-11-03 |
| TASK-063 | Implement `modules/social/reshares`: `POST /posts/:id/reshare` (RUL-019, `CONFIRMATION_REQUIRED`, calls `syncReshareEventOnCreate` for both fake and admin real originals) and `DELETE /posts/:id/reshare` (soft-deletes reshare and calls `retractReshareEventOnDelete` in the same transaction; ensure `DELETE /posts/:id` also calls `retractReshareEventOnDelete` when the deleted post has `kind = 'reshare'`). | [x] | 2026-11-03 |
| TASK-064 | Implement `modules/search` (RUL-030: `GET /search/posts` and `/search/users` with keyset pagination). | [x] | 2026-11-03 |
| TASK-065 | Implement `modules/social/suggestions` (RUL-029: two-hop mutuals + fallback fill, never using `q` or tier). | [x] | 2026-11-03 |
| TASK-066 | Write `apps/api/test/social/flows.test.ts` covering TEST-070 through TEST-079 (like on fake post creates `MISINFO_LIKE`, unlike before finalization voids it with `interaction_retracted`, unlike after finalization leaves counted event intact, re-like reactivates event without 23505 error; reshare of admin real post creates `RESPONSIBLE_RESHARE`, retracting reshare before finalization voids `MISINFO_RESHARE` / `RESPONSIBLE_RESHARE`, retracting after finalization leaves counted event intact; comments never create events). | [x] | 2026-11-03 |

Verification (2026-11-03): social integration tests pass against real PostgreSQL for follow/unfollow, block/unblock, connection pagination, two-hop suggestions, full-text and trigram search, warning-gated fake reshares, retraction, fake-post scoring hooks, comments without scoring, and admin-real reshare rewards.

### Implementation Phase 9: Credibility policy (Layer 1 and Layer 2)

- GOAL-009: Labels, tiers, confirmation prompts, and optional low-tier holds, derived strictly from detection bands, assessments, and user Q without altering scoring math (DEC-002).
- **Audit Findings & Policy Decisions Resolved:** DEC-002 & Audit Gap 3 (publisher tier triggers governance friction `requiresShareConfirmation` and optional hold RUL-024, while never modifying event weights).
- **Relevant Files:** `apps/api/src/scoring/tier.ts`, `apps/api/src/modules/posts/service.ts`, `apps/api/src/modules/admin/analytics.ts`.
- **Dependencies:** Depends on Phase 3, Phase 6, and Phase 7.
- **Acceptance Criteria:** `tier.ts` unit tests and spread analytics tests pass.

| Task | Description | Completed | Date |
|---|---|---|---|
| TASK-067 | Implement `src/scoring/tier.ts` (`tierOf(q: Decimal)` per RUL-011) and use it in every serializer. | [x] | 2026-11-03 |
| TASK-068 | Finalize post serialization of `label`, `underAppeal`, and `requiresShareConfirmation` (true when label is `auto_flagged` or `fact_checked_false` or author tier is `low`). | [x] | 2026-11-03 |
| TASK-069 | Implement the low-tier hold rule (RUL-024) inside post creation and admin release. | [x] | 2026-11-03 |
| TASK-070 | Implement `GET /admin/analytics/spread` query (reshares and active likes before and after label time, grouped by wave number and `author_tier_at_post`). | [x] | 2026-11-03 |

Verification (2026-11-03): tier boundary tests pass at inclusive trusted/low thresholds; post label, confirmation, and low-tier hold behavior pass existing integration tests; spread analytics passes real-PostgreSQL authorization and before/after label-time grouping tests.

### Implementation Phase 10: Direct messages

- GOAL-010: Real-time one-to-one messaging with block enforcement (DEC-006: messages never create scoring events).
- **Dependencies:** Depends on Phase 5 and Phase 8.
- **Acceptance Criteria:** TEST-080–TEST-086 pass.

| Task | Description | Completed | Date |
|---|---|---|---|
| TASK-071 | Implement `modules/messages` REST endpoints and `src/realtime/ws.ts` (REQ-042). | [x] | 2026-11-03 |
| TASK-072 | Write `apps/api/test/messages/messages.test.ts` (TEST-080–TEST-086). | [x] | 2026-11-03 |

Verification (2026-11-03): direct-message REST tests pass for sending, conversation ordering, unread counts, history, read receipts, block enforcement, and suspended senders. Real WebSocket tests pass for REST-to-socket delivery, read notifications, unauthenticated rejection, and Origin rejection.

### Implementation Phase 11: Analytics, exports and API documentation

- GOAL-011: Admin insight, CSV export (including `MISINFO_LIKE`, `RESPONSIBLE_RESHARE`, and `void_reason`), and a generated OpenAPI 3.1 contract.
- **Dependencies:** Depends on Phase 6, Phase 7, and Phase 9.
- **Acceptance Criteria:** TEST-090–TEST-094 pass; `docs/openapi.yaml` is up to date (REQ-034).

| Task | Description | Completed | Date |
|---|---|---|---|
| TASK-073 | Implement `GET /admin/analytics/overview`, `/detector`, and `/waves`. | | |
| TASK-074 | Implement CSV exports `GET /admin/export/ledger.csv`, `/events.csv`, `/assessments.csv`. | | |
| TASK-075 | Generate OpenAPI 3.1 from the Zod schemas into `docs/openapi.yaml` via `npm run docs:openapi`. | | |
| TASK-076 | Write `apps/api/test/admin/analytics.test.ts` (TEST-090–TEST-094). | | |

### Implementation Phase 12: Frontend

- GOAL-012: Every screen of Section 1.8 is implemented against the real API, displaying all 7 event kinds, retraction statuses, and updated admin assessment consequences.
- **Audit Findings & Policy Decisions Resolved:** UI transparency for `MISINFO_LIKE`, `RESPONSIBLE_RESHARE`, and `interaction_retracted` (DEC-001, DEC-003, DEC-005).
- **Dependencies:** Depends on Phases 1–11.
- **Acceptance Criteria:** Component tests (TASK-102) pass; zero client-side score arithmetic.

| Task | Description | Completed | Date |
|---|---|---|---|
| TASK-077 | Foundation: app shell, shared UI components, `useMe` hook, route guards, `src/copy.ts` (including copy for `RESPONSIBLE_RESHARE`, `MISINFO_LIKE`, and `interaction_retracted`). | | |
| TASK-078 | Auth pages (`/login`, `/register`, `/forgot-password`, `/reset-password`, `/verify-email`). | | |
| TASK-079 | `PostCard` component. | | |
| TASK-080 | `Composer` component. | | |
| TASK-081 | Home page (Global and Following tabs, composer, Who to follow). | | |
| TASK-082 | Post detail page `/p/:id`. | | |
| TASK-083 | Interaction components: like toggle, reshare dialog (with `CONFIRMATION_REQUIRED` prompt), retract reshare, report dialog, edit/delete post. | | |
| TASK-084 | Profile page `/u/:username`, followers, following. | | |
| TASK-085 | Settings page. | | |
| TASK-086 | Search page `/search`. | | |
| TASK-087 | Notifications page and `useNotificationStream` SSE hook. | | |
| TASK-088 | Messages pages and WebSocket hook. | | |
| TASK-089 | Score page `/score` (current Q, tier, sigma, pending current-wave projection). | | |
| TASK-090 | Score history table and per-wave explanation drawer showing all 7 event kinds and arithmetic `R = n+ - n- + adjustments`. | | |
| TASK-091 | Events list (pending, counted, voided with reason chips) with Appeal button for eligible negative events (`MISINFO_POST`, `MISINFO_RESHARE`, `MISINFO_LIKE`), and `/appeals` page. | | |
| TASK-092 | Admin shell (`/admin`) and overview page. | | |
| TASK-093 | Admin review queue page (showing reported `auto_real` posts alongside unassessed flagged/reported posts). | | |
| TASK-094 | Admin review workspace `/admin/posts/:id` (showing consequence summary including author, resharers, likers, and reporters). | | |
| TASK-095 | Admin appeals page. | | |
| TASK-096 | Admin waves page. | | |
| TASK-097 | Admin users page, audit log page, and score verification page. | | |
| TASK-098 | Admin analytics page with recharts and CSV export buttons. | | |
| TASK-099 | Legal pages (`/legal/terms`, `/legal/privacy`, `/legal/guidelines` explaining how posts, reshares, likes, reports, retractions, and waves affect scores). | | |
| TASK-100 | Global error/empty/loading states. | | |
| TASK-101 | Accessibility and responsiveness pass (360 px to 1280 px, WCAG 2.1 AA). | | |
| TASK-102 | Component tests (Vitest and Testing Library) for `PostCard`, score explanation drawer (including `MISINFO_LIKE` and `RESPONSIBLE_RESHARE`), reshare dialog, and composer. | | |

### Implementation Phase 13: Security and observability

- GOAL-013: Security controls are enforced and proven; the system is observable.
- **Dependencies:** Depends on Phases 5–12.
- **Acceptance Criteria:** TEST-106 and TEST-107 pass.

| Task | Description | Completed | Date |
|---|---|---|---|
| TASK-103 | Write `apps/api/test/security/headers-and-limits.test.ts` (TEST-106). | | |
| TASK-104 | Add Sentry and prom-client metrics at `/metrics`. | | |
| TASK-105 | Tests for logging redaction and graceful shutdown (REQ-037). | | |
| TASK-106 | Implement and rehearse `scripts/backup.sh` and `scripts/restore.sh` (REQ-045). | | |
| TASK-107 | Write `apps/api/test/security/abuse.test.ts` (TEST-107) and `docs/SECURITY.md`. | | |

### Implementation Phase 14: Test completion

- GOAL-014: End-to-end, concurrency, performance, and regression coverage on the real stack.
- **Audit Findings & Policy Decisions Resolved:** E2E verification (F02, F05, F15) of like penalties, verified reshare rewards, and pre-finalization retractions.
- **Dependencies:** Depends on Phases 1–13.
- **Acceptance Criteria:** Playwright E2E suite (TEST-108), load test (TEST-109), detector regression (TEST-110), and 100% scoring coverage gate (TEST-111) pass.

| Task | Description | Completed | Date |
|---|---|---|---|
| TASK-108 | Set up Playwright in `e2e/` with real docker-compose services and axe-core checks (REQ-028). | | |
| TASK-109 | Implement E2E specs (TEST-108): F01–F14 plus F15 (user likes and reshares a post that is assessed fake, sees pending -2 in `/score`, retracts the reshare before wave finalization to reduce pending penalty to -1, wave is finalized, then attempts to unlike after finalization and confirms finalized score is unchanged; user reshares an admin-verified real post and receives +1 on wave finalization). | | |
| TASK-110 | Implement `scripts/load-test.ts` (TEST-109). | | |
| TASK-111 | Add `services/detector/tests/test_regression.py` (TEST-110). | | |
| TASK-112 | Enforce coverage gates in Vitest config and CI (REQ-018, TEST-111: `apps/api/src/scoring` 100% lines and branches; `apps/api` >= 80% lines). | | |

### Implementation Phase 15: Deployment and operations

- GOAL-015: A public HTTPS deployment on real managed services, verified by automated smoke tests.
- **Dependencies:** Depends on Phases 12–14.
- **Acceptance Criteria:** TEST-113 (`smoke-prod.ts`) passes against production.

| Task | Description | Completed | Date |
|---|---|---|---|
| TASK-113 | Add `apps/api/src/static.ts` and root multi-stage Dockerfile. | | |
| TASK-114 | Create `render.yaml` (including `LIKE_PENALTY_ENABLED`, `RESPONSIBLE_RESHARE_REWARD_ENABLED`, `MAX_RESPONSIBLE_RESHARE_EVENTS_PER_WAVE`). | | |
| TASK-115 | Provision Neon PostgreSQL 16 database and roles. | | |
| TASK-116 | Provision Cloudflare R2 bucket and SMTP provider. | | |
| TASK-117 | Configure production secrets and threshold environment variables. | | |
| TASK-118 | Deploy detector service and verify `/healthz` and `/v1/predict`. | | |
| TASK-119 | Deploy api-web, run migrations, create production admin. | | |
| TASK-120 | Implement and run `scripts/smoke-prod.ts` (TEST-113). | | |
| TASK-121 | Verify provider limits and record in `docs/DEPLOYMENT.md`. | | |
| TASK-122 | Create `.github/workflows/backup.yml`. | | |

### Implementation Phase 16: Documentation and academic deliverables

- GOAL-016: Complete documentation, paper-to-code mapping (including v2.0 policy decisions), and live demonstration script.
- **Dependencies:** Depends on Phase 15.
- **Acceptance Criteria:** TEST-112 (`demo-scenario.ts`) and full acceptance checklist (TASK-133) pass.

| Task | Description | Completed | Date |
|---|---|---|---|
| TASK-123 | Write `README.md`. | | |
| TASK-124 | Write `docs/ARCHITECTURE.md` (including interaction & retraction lifecycle diagrams). | | |
| TASK-125 | Write `docs/ER.md` (reflecting updated `reputation_events`, `likes`, `appeals`, and `review_queue_v`). | | |
| TASK-126 | Write `docs/PAPER_MAPPING.md` mapping Equations 1–2, Propositions 1–3, and explicitly documenting DEC-001 through DEC-006 as platform-specific instantiations of `n_i^+(w)` and `n_i^-(w)` under Section 3.2 of the paper. | | |
| TASK-127 | Write `docs/DETECTOR.md`. | | |
| TASK-128 | Implement `npm run docs:scoring-report` generating `docs/SCORING_TESTS.md`. | | |
| TASK-129 | Implement `scripts/demo-scenario.ts` (TEST-112) demonstrating publisher scoring, `MISINFO_LIKE`, `RESPONSIBLE_RESHARE`, reshare retraction before wave finalization, and `verify-scores`. | | |
| TASK-130 | Write `docs/DEMO.md` and capture screenshots. | | |
| TASK-131 | Write `docs/REPORT.md`. | | |
| TASK-132 | Write `docs/LIMITATIONS.md` (explicitly noting why comment semantic/sentiment scoring is out of scope per DEC-006). | | |
| TASK-133 | Final acceptance run across CI, E2E, OpenAPI, scoring report, and demo scenario. | | |

---

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

---

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

---

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

---

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
- **TEST-027**: Good-Faith Window protection (Audit Gap 6): Admin assesses Post P as real. User B reshares P and User C likes P while P carries `fact_checked_true`. Later, Admin supersedes the assessment of P with fake. Author U receives a reversal (-1) and `MISINFO_POST` (-1), whereas User B has her `RESPONSIBLE_RESHARE` voided/reversed and neither User B nor User C receives `MISINFO_RESHARE` or `MISINFO_LIKE`. A User D who reshared P before the initial real assessment (or after the fake supersede) does receive `MISINFO_RESHARE` (-1).
- **TEST-028**: Historical reporter reward on superseded assessment (Audit Gap 5): User R reports Post P. Admin assesses P as unverifiable (or auto_real runs first, or admin assesses real), resolving R's report with 0 events. Later, Admin supersedes the assessment of P with fake. User R receives `VALID_REPORT` (+1) in the open wave.
- **TEST-029**: Like penalty on false post & pre-finalization retraction (DEC-001, Audit Gap 1): User L likes Post P. Admin assesses P as fake -> `MISINFO_LIKE` (-1, eligible) is created for L. User L unlikes P before wave finalization -> `MISINFO_LIKE` becomes `status = 'voided'`, `void_reason = 'interaction_retracted'`. Wave finalizes -> L has `n_neg = 0, delta = 0`.
- **TEST-030**: Like retraction blocked after wave finalization (DEC-001, DEC-005): User L likes Post P, Admin assesses P as fake, Wave 1 is finalized (L's `MISINFO_LIKE` is counted, `Q_L = -sigma_L`). In Wave 2, User L unlikes P. The likes row is soft-deleted (`deleted_at IS NOT NULL`), but the counted event and Wave 1 ledger row remain unchanged and `verifyScores()` passes.
- **TEST-031**: Verified-true reshare reward & cap (DEC-003, Audit Gap 2): Admin assesses 6 original posts as real. User S reshares all 6 in Wave 1. The first 5 create eligible `RESPONSIBLE_RESHARE` (+1) events; the 6th is inserted as `status = 'voided'`, `void_reason = 'cap_exceeded'`. An `auto_real` assessment on a 7th post creates `RESPONSIBLE_POST` (+1) for its author but zero `RESPONSIBLE_RESHARE` events for resharers.
- **TEST-032**: Reshare retraction before vs. after wave finalization (DEC-005): User S reshares a post already assessed as fake (`acknowledgedWarning = true`), receiving an eligible `MISINFO_RESHARE` (-1) event, and opens an appeal on it (`status = 'held'`). User S then deletes the reshare before wave finalization -> the event transitions to `status = 'voided'`, `void_reason = 'interaction_retracted'` and the appeal is auto-closed. Once a wave is finalized (`status = 'counted'`), deleting the reshare leaves the counted event and ledger untouched.
- **TEST-033**: Repeated reshare and repeated like idempotency (Audit Gap 7): On a post currently assessed as fake, User X likes -> unlikes (voided) -> re-likes -> unlikes -> re-likes, and reshares -> deletes reshare (voided) -> re-shares. Zero 23505 unique constraint errors occur; exactly one eligible `MISINFO_LIKE` and one eligible `MISINFO_RESHARE` exist for User X.
- **TEST-034**: Publisher reputation independence (DEC-002, Audit Gap 3): Publisher A (trusted, Q = +5.0) and Publisher B (low, Q = -3.0) each publish a post later assessed as fake. User X (`sigma_X = 0.5`) likes and reshares both posts. User X's events for A's post and B's post have identical integer values (-1 each).
- **TEST-035**: Flat publisher penalty on viral false post (DEC-004, Audit Gap 3): Publisher A publishes Post P_1 (0 likes, 0 reshares) and Post P_2 (25 likes, 15 reshares). Both are assessed as fake. Publisher A receives exactly one `MISINFO_POST` (-1) for P_1 and one `MISINFO_POST` (-1) for P_2.
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
- **TEST-067**: Reported `auto_real` post enters review queue (Audit Gap 4): Post P receives `auto_real` assessment (`is_current = true`). User R submits a report on P (`POST /posts/:id/report`). `GET /admin/queue` immediately includes Post P. Admin assesses P as fake -> `auto_real` assessment is superseded (`is_current = false`), author's `RESPONSIBLE_POST` (+1) is voided/reversed, author gets `MISINFO_POST` (-1), and reporter R gets `VALID_REPORT` (+1).
- **TEST-068**: Admin upgrading `auto_real` to admin real: Post P has an `auto_real` assessment (label = 'none') and 2 reshares. Admin submits `POST /admin/posts/:id/assessments` with `verdict = 'real'`. The request succeeds (201, not 409), supersedes the `auto_real` row with an admin real row, updates label to 'fact_checked_true', keeps the author's +1 reward net-neutral, and awards `RESPONSIBLE_RESHARE` (+1) to the 2 resharers.
- **TEST-069**: Comments never affect reputation (DEC-006): Users post 10 comments on a fake post and 10 comments on a real post, then delete half of them. Zero `reputation_events` are created for commenters.
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
- **TEST-108**: End-to-end suite F01 to F14 plus F15 with axe checks (TASK-109).
- **TEST-109**: Load and concurrency gates (TASK-110).
- **TEST-110**: Detector regression against the golden file (TASK-111).
- **TEST-111**: Coverage gates (TASK-112).
- **TEST-112**: Demo scenario assertions: alice 4.8, bob -4.8, carol 2.4, dan 0.0, eve 1.6, `q = sigma * sum(r)` for all, `verify-scores` OK (TASK-129).
- **TEST-113**: Production smoke test (TASK-120).

---

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

---

## 8. Related Specifications / Further Reading

- Source paper: "Towards A Platform-Level Reward-Penalty Framework for Misinformation Intervention on Social Media" (Section 3 Equation 2, Section 4 Propositions 1 to 3).
- LIAR dataset paper: https://aclanthology.org/P17-2067/
- LIAR dataset card: https://huggingface.co/datasets/ucsbnlp/liar
- Render free web services: https://render.com/docs/free
- Neon pricing and limits: https://neon.com/pricing
- Hugging Face Spaces overview: https://huggingface.co/docs/hub/spaces-overview
- OWASP Password Storage Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html

---

## 9. Traceability Matrix (Audit Findings & Policy Decisions -> Tasks & Tests)

| ID | Policy Decision / Audit Finding | Updated Rules & Schema Objects | Implementing Files & Tasks | Verification Tests |
|---|---|---|---|---|
| DEC-001 & Gap 1 | Likes on false posts penalized (`MISINFO_LIKE` -1) & auditable soft-delete lifecycle | RUL-002, RUL-003, RUL-004, RUL-009, RUL-016, RUL-032; likes (`updated_at`, `deleted_at`, `likes_target_original_trg`); reputation_events (`MISINFO_LIKE`) | `packages/shared/src/enums.ts` (TASK-002), `0003_governance_scoring.sql` (TASK-013), `0004_social.sql` (TASK-014), `scoring/events.ts` (TASK-021), `scoring/finalizeWave.ts` (TASK-022), `social/likes.ts` (TASK-061), `web/src/copy.ts` (TASK-077, TASK-090) | TEST-029, TEST-030, TEST-033, TEST-060, TEST-070, TEST-103, TEST-104, TEST-108 (F15) |
| DEC-002 & Gap 3a | Publisher reputation independence (no publisher-to-interactor score coupling) | RUL-003, RUL-009, RUL-019; `user_wave_reputation` CHECKs | `scoring/pure.ts` (TASK-020), `scoring/events.ts` (TASK-021), `scoring/tier.ts` (TASK-067), `docs/PAPER_MAPPING.md` (TASK-126) | TEST-001–TEST-015, TEST-034, TEST-074 |
| DEC-003 & Gap 2 | Verified-true reshares rewarded (`RESPONSIBLE_RESHARE` +1, capped per wave) | RUL-002, RUL-003, RUL-004, RUL-005, RUL-009, RUL-019; `reputation_events` (`RESPONSIBLE_RESHARE`, `reshare_post_id`) | `packages/shared/src/enums.ts` (TASK-002), `config.ts` (TASK-005), `0003_governance_scoring.sql` (TASK-013), `scoring/events.ts` (TASK-021), `scoring/finalizeWave.ts` (TASK-022), `governance/assessments.ts` (TASK-055), `social/reshares.ts` (TASK-063) | TEST-031, TEST-068, TEST-074, TEST-103, TEST-108 (F15) |
| DEC-004 & Gap 3b | Viral false posts keep flat -1 publisher penalty (`MISINFO_POST`) | RUL-003, RUL-004; `events_one_per_assessment_uq` | `0003_governance_scoring.sql` (TASK-013), `scoring/events.ts` (TASK-021) | TEST-035, TEST-051, TEST-103 |
| DEC-005 & Gap 7a | Reshare retraction voids eligible/held events before wave finalization; finalized waves stay immutable | RUL-007, RUL-019; `reputation_events` (`void_reason = 'interaction_retracted'`, `events_guard_trg`, `ledger_guard_trg`) | `0003_governance_scoring.sql` (TASK-013), `scoring/events.ts` (TASK-021), `social/reshares.ts` (TASK-063), `posts/service.ts` (TASK-043, TASK-063) | TEST-032, TEST-057, TEST-103, TEST-108 (F15) |
| DEC-006 | Comments excluded from reputation scoring (no NLP / sentiment pipeline) | RUL-003; `comments` table decoupled from `reputation_events` | `social/comments.ts` (TASK-061), `docs/LIMITATIONS.md` (TASK-132) | TEST-069, TEST-071 |
| Gap 4 | `auto_real` bug blocking subsequently reported posts from entering `review_queue_v` | RUL-013, RUL-015; `review_queue_v` in `0005_search_and_views.sql` | `0005_search_and_views.sql` (TASK-015), `governance/reports.ts` (TASK-054), `governance/assessments.ts` (TASK-055), `jobs/autoReal.ts` (TASK-056) | TEST-067, TEST-068, TEST-103 |
| Gap 5 | Loss of `VALID_REPORT` (+1) when initial real/unverifiable/auto_real assessment is superseded by fake | RUL-004, RUL-015 | `scoring/events.ts` (TASK-021), `scoring/corrections.ts` (TASK-024), `governance/assessments.ts` (TASK-055) | TEST-028, TEST-067 |
| Gap 6 | Retroactive penalties against good-faith resharers/likers when admin real verdict is overturned to fake | RUL-004, RUL-015 (Good-Faith Window exemption) | `scoring/events.ts` (TASK-021), `scoring/corrections.ts` (TASK-024) | TEST-027 |
| Gap 7b | Wave assignment timing, duplicate/repeated reshares & likes, 23505 conflict prevention, reversal integrity | RUL-004, RUL-007, RUL-015, RUL-019, RUL-032, PAT-005; `events_one_per_assessment_uq`, `events_one_reversal_uq` | `scoring/events.ts` (TASK-021), `scoring/finalizeWave.ts` (TASK-022), `scoring/verify.ts` (TASK-023), `scoring/corrections.ts` (TASK-024), `social/likes.ts` (TASK-061), `social/reshares.ts` (TASK-063) | TEST-016–TEST-026, TEST-033, TEST-103 |

---

## 10. Residual Edge Cases & Confirmation Check

To ensure zero silent assumptions, the revised plan specifies deterministic defaults for four secondary sub-cases that arise from combining your six policy decisions. Please review and let me know if you want to adjust any of these four defaults before we begin code execution:

1. **`auto_real` vs. Admin real for `RESPONSIBLE_RESHARE` (+1) (RUL-002, RUL-004):**
   - *Specified Behavior:* In the plan above, `RESPONSIBLE_RESHARE` (+1) is awarded only when a post is verified as real by an admin (`source = 'admin'`, `verdict = 'real'`, which carries the public "Fact-check: Verified" badge), not when a post merely passes the 60-minute `auto_real` unreviewed timer (`source = 'auto_real'`, which displays `label = 'none'`). Additionally, `MAX_RESPONSIBLE_RESHARE_EVENTS_PER_WAVE` is set to 5 (matching `MAX_RESPONSIBLE_POST_EVENTS_PER_WAVE`).
   - *Question:* Do you confirm restricting `RESPONSIBLE_RESHARE` (+1) to admin-verified real posts with a cap of 5 per wave, or should `auto_real` posts also reward resharers?
2. **Both Liking and Resharing the Same False Post (RUL-004):**
   - *Specified Behavior:* Because `MISINFO_LIKE` (-1) and `MISINFO_RESHARE` (-1) are distinct kind values in `reputation_events`, a user who both likes and reshares a false post receives -1 for the like and -1 for the reshare (-2 total in that wave, each independently retractable before wave finalization).
   - *Question:* Should liking and resharing the same false post count as two separate -1 actions (-2 total) as specified, or should a user be capped at -1 total penalty per false post across all interaction types?
3. **Unliking a False Post Before Wave Finalization (RUL-032):**
   - *Specified Behavior:* Consistent with DEC-005 (reshare retraction before wave finalization), unliking a post (`DELETE /posts/:id/like`) before the wave is finalized voids an eligible `MISINFO_LIKE` event (`void_reason = 'interaction_retracted'`), while unliking after wave finalization leaves the counted event immutable.
   - *Question:* Do you confirm allowing pre-finalization unlike to retract an eligible `MISINFO_LIKE` penalty just like reshare retraction?
4. **Liking a Reshare vs. Liking an Original Post (`0004_social.sql`):**
   - *Specified Behavior:* `likes_target_original_trg` enforces that likes attach to the original post (just as `posts_reshare_target_trg` enforces that reshares point to the original post).
   - *Question:* Do you confirm that likes target original posts only?
