# Security Architecture and Threat Model

This document outlines the security architecture, threat model, access control policies, and operational controls implemented across the Fake News Intervention Platform.

---

## 1. Threat Model & Adversarial Surface

The platform operates in an adversarial environment where coordinated actors may attempt to amplify misinformation, manipulate reputation scoring, or attack infrastructure.

| Threat Category | Potential Attack Vectors | Platform Mitigations |
|---|---|---|
| **Misinformation Amplification** | Coordinated reshares and likes to spread disputed claims before review. | Automated RoBERTa detection prioritizes likely-fake posts in the review queue; rewards and penalties exist only after a human administrator assessment (or the narrow `auto_real` rule for low-risk posts). |
| **Score Tampering & Sybil Attacks** | Malicious actors manipulating reputation scores $Q$ or exploiting event deltas. | Zero client-side arithmetic. All scores are computed strictly in Postgres transactions on discrete wave boundaries ($Q_{w+1} = Q_w + \sigma \cdot R_w$). |
| **Good-Faith Window Exploitation** | Users claiming they shared misinformation in good faith after formal labelling. | Clear timestamp demarcation: interactions prior to admin label are marked `interaction_retracted` if retracted; interactions post-label incur immutable penalties. |
| **Cross-Site Request Forgery (CSRF)** | Attackers tricking logged-in users into liking, sharing, or posting via external sites. | Strict server-side `Origin` validation for all mutating methods (`POST`, `PATCH`, `PUT`, `DELETE`). |
| **Session Hijacking & Sniffing** | Intercepting user credentials or tokens on the wire or via XSS. | Session tokens are 32 random bytes stored as SHA-256 hashes in Postgres; delivered via `HttpOnly`, `SameSite=Lax`, `Secure` cookies. |
| **Insecure Direct Object Reference (IDOR)** | Attackers attempting to edit or delete posts, comments, or appeals of other users. | Every mutating service function asserts user ownership or administrator role (`author_id = req.user.id`). |
| **SQL Injection & Mass Assignment** | SQL escape characters or unexpected payload keys attempting privilege escalation. | Parameterized SQL queries throughout (`$1`, `$2`), combined with strict Zod `.strict()` schema parsing that strips/rejects undeclared keys. |
| **Stored & Reflected XSS** | Injecting `<script>` or HTML event handlers into post bodies, bios, or comments. | Rendered as text nodes in React; protected by rigorous Content Security Policy (`script-src 'self'`, `object-src 'none'`). |
| **Server-Side Request Forgery (SSRF)** | Submitting internal/loopback IPs or private metadata endpoints in `sourceUrl`. | Strict Zod URL protocol validation; the API service never executes server-side HTTP fetches against user-provided URLs. |

---

## 2. Authentication & Session Management

- **Password Hashing (SEC-001):** Passwords are hashed using `argon2id` with recommended RFC 9106 parameters:
  - Memory cost: `19456 KiB`
  - Time cost (iterations): `2`
  - Parallelism: `1`
- **Session Tokens (SEC-002):**
  - Generated using `crypto.randomBytes(32)` encoded as `base64url`.
  - Only the SHA-256 hash (`crypto.createHash('sha256').update(rawToken).digest('hex')`) is stored in the `sessions` table.
  - Revocation is instantaneous by deleting the session row in Postgres.
- **Cookie Security:**
  - `HttpOnly`: Prevents JavaScript access and XSS theft.
  - `SameSite=Lax`: Defends against cross-site request forgery.
  - `Secure`: Transmitted only over HTTPS in production environments.

---

## 3. Mathematical Integrity & Ledger Invariants

The reputation score system enforces six mathematical invariants ($I_1$ to $I_6$) verified via automated audits (`POST /api/v1/admin/verify-scores`):

1. **$I_1$ (Continuity):** For any wave $w > 1$, $Q_{\text{before}}(w) = Q_{\text{after}}(w - 1)$.
2. **$I_2$ (Formula Compliance):** $R_w = N_{\text{pos}} - N_{\text{neg}} + N_{\text{adj}}$, and $Q_{\text{after}} = Q_{\text{before}} + \sigma \cdot R_w$.
3. **$I_3$ (Live Score Invariant):** The user's active score $Q$ strictly equals the latest finalized $Q_{\text{after}}$ plus bounded pending adjustments.
4. **$I_4$ (Sensitivity Invariant):** $\sigma_{\text{used}}$ matches the user's registered $\sigma$ parameter.
5. **$I_5$ (Event Parity):** Event counts in the wave ledger match the count of eligible ledger rows.
6. **$I_6$ (Finality Invariant):** No newly created event may target an already-finalized wave.

---

## 4. HTTP Headers & Transport Hardening

Every HTTP response from Express includes defensive headers managed via `helmet`:

- `Content-Security-Policy` (SEC-005):
  `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: <origin of S3_PUBLIC_BASE_URL>; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`, plus helmet's defaults (`object-src 'none'`, `script-src-attr 'none'`, `upgrade-insecure-requests`). The image origin is derived from `S3_PUBLIC_BASE_URL` at startup (`http://localhost:9000` locally, the R2 public host in production). Fonts are self-hosted so no third-party origin is needed.
- `X-Content-Type-Options: nosniff`: Prevents MIME-confusion attacks.
- `X-Frame-Options: SAMEORIGIN`: Defends against UI redressing / clickjacking.
- `Referrer-Policy: no-referrer`: Prevents leaking sensitive paths or identifiers in referrer headers.
- `Cross-Origin-Opener-Policy: same-origin` & `Cross-Origin-Resource-Policy: same-origin`.
- **Payload Limits (TASK-005, Section 1.7):** JSON body parsing is restricted to `100kb`. Requests exceeding this size are rejected with `413 PAYLOAD_TOO_LARGE`.
- **Input normalization (REQ-026):** every string in params, query and body is NFC-normalized before validation; strings containing control characters other than newline are rejected with `400 VALIDATION_ERROR`.

---

## 5. Rate Limiting & Abuse Defense

Rate limiting uses `express-rate-limit` with an in-memory store (CON-003: one instance). Limits are keyed by user id when signed in, otherwise by IP (Section 1.7):

| Scope | Window | Limit |
|---|---|---|
| Global, per IP (`GLOBAL_RATE_LIMIT_PER_MINUTE`) | 1 minute | 300 |
| `POST /auth/login` (per IP) | 1 minute | 10 |
| `POST /auth/register` (per IP) | 1 hour | 5 |
| `POST /auth/forgot-password` (per IP) | 1 hour | 5 |
| `POST /posts` | 1 hour | 20 |
| Comments | 1 hour | 60 |
| Likes | 1 hour | 300 |
| Reshares | 1 hour | 60 |
| Reports | 1 hour | 30 |
| Media uploads | 1 hour | 30 |
| Messages | 1 hour | 120 |
| Follows and blocks | 1 hour | 100 |
| Appeals | 24 hours | 5 |
| Search | 1 minute | 60 |

Exceeded limits return `429 RATE_LIMITED` with standard `RateLimit`/`Retry-After` headers. Independently of these limits, login applies a lockout of 5 failed attempts per identifier and IP within 15 minutes (SEC-003), returning 429 with a message that does not reveal whether the account exists.

## 6. Observability & Logging Redaction

- **Structured Logging (Pino):**
  Logs are formatted as structured JSON lines. Sensitive fields are automatically redacted before serialization:
  `password`, `token`, `cookie`, `authorization`, `email`, `req.headers.authorization`, `res.headers["set-cookie"]`.
- **Metrics (Prometheus):**
  Prometheus metrics are served at `GET /metrics`, protected by `METRICS_TOKEN` via `Authorization: Bearer <TOKEN>` only (DEC-014). `METRICS_TOKEN` is mandatory in production; the process refuses to start without it.
- **Error Tracking (Sentry):**
  Unhandled 500 errors and critical exceptions report to Sentry when `SENTRY_DSN` is configured. Sensitive request headers and tokens are excluded from breadcrumbs.

---

## 7. Disaster Recovery & Backups

- Automated database backups are generated using `scripts/backup.sh` producing custom-format compressed dumps (`pg_dump -Fc`).
- Database restorations are rehearsed using `scripts/restore.sh` (`pg_restore --clean --if-exists`).
- Media objects are stored under their immutable media UUID (DEC-009); the key is never reused, so a restore cannot overwrite a newer object.
