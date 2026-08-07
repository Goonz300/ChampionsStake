# Attack Matrix — Per-Endpoint Rate Limits

Generated from the actual `rateLimit:` configuration in each function's `index.ts` (Edge Functions) or explicit limiter call (web app) — not aspirational. "Global default" means the function relies on `compose.ts`'s fallback (`EDGE_RATE_LIMIT_WINDOW_SECONDS`/`EDGE_RATE_LIMIT_MAX_REQUESTS`, default 60s/60req) rather than a tuned override.

## Web App (Next.js, Postgres/`audit_logs`-backed)

| Endpoint | Window | Max Attempts | Key |
|---|---|---|---|
| `POST /api/auth/login` | 15 min | 5 (failures) | email + IP |
| `POST /api/auth/mfa/verify` | 15 min | 5 (failures, fail-closed) | factor_id |
| `POST /api/auth/mfa/recovery-codes/verify` | 15 min | 5 (failures, pre-existing) | — |
| `POST /api/auth/register` | 15 min | 10 (attempts) | IP |
| `POST /api/auth/forgot-password` | 15 min | 10 (attempts) | IP |
| `POST /api/auth/reset-password` | 15 min | 10 (attempts) | IP |
| `POST /api/auth/mfa/enroll` | 60 min | 10 (attempts) | user id |
| `POST /api/auth/resend-verification` | — | 1 per 5 min | Supabase Auth's own built-in cooldown, not this codebase's limiter |
| `POST /api/auth/logout`, `/logout-all` | — | unlimited | Low abuse value; not rate limited |

Additional web-app controls layered on top of `login`: progressive delay (0/2/5/15/30s by failure count), account lockout (15min → doubling, capped 24h), CAPTCHA (Turnstile, triggered at 3 failures if configured).

## Edge Functions (Deno, Upstash Redis / Postgres fallback)

| Function | Window | Max | Key basis |
|---|---|---|---|
| **Auth-adjacent** | | | |
| presence-update | 30s | 10 | user |
| typing-update | 10s | 20 | user |
| **Wallet / Payment** | | | |
| payment-initialize | 60s | 10 | user |
| payment-transfer (withdraw) | 60s | 10 | user |
| payment-verify | — | global default | user |
| payment-refund | 60s | 5 | user |
| payment-status | 60s | 30 | user |
| payment-webhook | 60s | 120 | **IP** (only unauthenticated endpoint) |
| payment-reconciliation | — | global default | user/scheduled |
| wallet-balance | 60s | 60 | user |
| wallet-history | 60s | 30 | user |
| wallet-transfer | 60s | 20 | user |
| wallet-adjustment | 60s | 10 | user |
| wallet-create | 60s | 5 | user |
| wallet-reconciliation | 60s | 5 | user/scheduled |
| **Gaming — Challenge** | | | |
| challenge-create | 60s | 20 | user |
| challenge-accept | 60s | 10 | user |
| challenge-cancel | 60s | 10 | user |
| challenge-publish | 60s | 10 | user |
| challenge-ready | 60s | 20 | user |
| challenge-declare-winner | 60s | 10 | user |
| challenge-release | 60s | 10 | user |
| challenge-complete | 60s | 10 | user |
| challenge-expire | 60s | 5 | user/scheduled |
| challenge-start | 60s | 20 | user/scheduled |
| challenge-timeline | 60s | 60 | user |
| challenge-update | 60s | 20 | user |
| challenge-browse | 60s | 60 | user or IP |
| **Gaming — Tournament** | | | |
| tournament-create | 60s | 10 | user |
| tournament-register | 60s | 10 | user |
| tournament-checkin | 60s | 20 | user/scheduled |
| tournament-publish | 60s | 10 | user |
| tournament-start-round | 60s | 10 | user |
| tournament-complete | 60s | 10 | user |
| tournament-complete-round | 60s | 10 | user/scheduled |
| tournament-advance-player | 60s | 10 | user |
| tournament-generate-bracket | 60s | 10 | user |
| tournament-archive | 60s | 5 | user/scheduled |
| tournament-browse | 60s | 60 | user or IP |
| **Chat / Realtime** | | | |
| chat-send | 60s | 60 | user |
| chat-messages | 60s | 60 | user |
| chat-edit | 60s | 30 | user |
| chat-delete | 60s | 20 | user |
| mark-read | 60s | 60 | user |
| **AI / Fraud** | | | |
| ai-recommendations | 60s | 20 | user |
| ai-fraud-scan | 60s | 5 | user/scheduled |
| ai-trust-score | 60s | 5 | user/scheduled |
| **Administration** | | | |
| admin-users | 60s | 30 | user (admin) |
| admin-wallets | 60s | 30 | user (admin) |
| admin-challenges | 60s | 30 | user (admin) |
| admin-tournaments | 60s | 30 | user (admin) |
| admin-announcements | 60s | 20 | user (admin) |
| admin-feature-flags | 60s | 20 | user (admin) |
| admin-system-health | 60s | 30 | user (admin) |
| admin-audit | 60s | 20 | user (admin) |
| admin-security | 60s | 30 | user (admin) |
| **Moderation** | | | |
| moderator-appeal | 60s | 20 | user (moderator) |
| moderator-assign | 60s | 20 | user (moderator) |
| moderator-dashboard | 60s | 30 | user (moderator) |
| moderator-decision | 60s | 20 | user (moderator) |
| moderator-escalate | 60s | 20 | user (moderator) |
| moderator-note | 60s | 20 | user (moderator) |
| **Scheduled / Maintenance** | | | |
| notification-send, email-queue-process, presence-sweep, sync-events, storage-cleanup, health | — | global default (60s/60) | user or IP |

Every function not listed with an explicit override still receives the **global default** (60s/60req, keyed by user or IP) via `compose.ts` — this closed the gap where roughly half the platform's Edge Functions previously had zero rate-limit protection.

## Fraud/Velocity Signals (Flag, Not Block)

| Signal | Threshold | Window | Where |
|---|---|---|---|
| Withdrawal velocity | > `FRAUD_WITHDRAWAL_VELOCITY_MAX` (default 3) | `FRAUD_WITHDRAWAL_VELOCITY_WINDOW_SECONDS` (default 60s) | `payment-transfer` |
| Challenge creation velocity | > `FRAUD_CHALLENGE_VELOCITY_MAX` (default 10) | default 60s | `challenge-create` |
| Tournament registration velocity | > `FRAUD_TOURNAMENT_VELOCITY_MAX` (default 5) | default 60s | `tournament-register` |
| Mass account creation (device farming) | ≥ 5 distinct accounts / device | 24h | `register` route |
| Failed login (informational, config-ready) | `FRAUD_FAILED_LOGIN_VELOCITY_MAX` (default 10) | `FRAUD_FAILED_LOGIN_VELOCITY_WINDOW_SECONDS` (default 900s) | config present; not yet wired to a flag-writer (see Threat Model gaps) |
| Password reset velocity (informational, config-ready) | `FRAUD_PASSWORD_RESET_VELOCITY_MAX` (default 5) | default 3600s | config present; forgot-password is rate-limited but does not yet write a fraud flag (would require resolving email→user_id, which the route deliberately avoids — see forgot-password's own enumeration-safety comment) |
