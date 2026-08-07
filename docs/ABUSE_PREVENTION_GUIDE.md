# Abuse Prevention Guide — Phase 5

Practical guide for moderators/admins and engineers on how ChampionsStake's abuse defenses behave, and what to do when they trigger.

## 1. What Happens When a User Hits a Limit

| Trigger | User-facing response | Recovery |
|---|---|---|
| Rate limit (any endpoint) | `429 RATE_LIMIT_EXCEEDED`, `Retry-After` header | Automatic — wait out the window |
| Login progressive delay | Response is delayed server-side (no error) | Automatic — delay shrinks back to 0 after failures stop |
| Account lockout | `423 ACCOUNT_LOCKED`, `Retry-After` header | Automatic (`locked_until` elapses) or admin unlock (`/api/admin/security`, `unlock_account`) |
| CAPTCHA required | `400 CAPTCHA_REQUIRED` (only if `CAPTCHA_SECRET_KEY` is configured) | Solve the challenge and resubmit with `captchaToken` |
| Fraud flag raised | **No user-facing effect** — flags never block | Moderator/admin reviews via `/api/admin/security?view=fraud_flags` |

The last row is the most important operational fact in this document: **nothing described in this phase auto-blocks funds, auto-suspends an account, or auto-rejects a registration.** Every fraud signal (`velocity_abuse`, `suspicious_withdrawal`, `multi_account`) lands in the `fraud_flags` queue for a human. This is a continuation of the AI-001 rule ("never auto-block funds without human review in v1"), not a new decision made in this phase.

## 2. Reviewing Fraud Flags

`GET /api/admin/security?view=fraud_flags&status=open` (admin only). Each flag has:
- `flag_type`: `collusion`, `multi_account`, `suspicious_withdrawal`, `suspicious_deposit`, `repeated_opponent`, or `velocity_abuse`
- `score`: 0–100, higher = more suspicious
- `details`: JSON — for velocity-derived flags, includes `signal`, `count`, `max_count`, `window_seconds`
- `primary_user_id` / `secondary_user_id` (the latter only for two-party signals)

Resolve with `POST /api/admin/security { action: "review_fraud_flag", flagId, outcome: "reviewed_cleared" | "reviewed_confirmed" }`.

## 3. Unlocking an Account

`login_lockouts` is keyed by `(email, ip_address)`, not `user_id` — this is deliberate (see the Threat Model and Rate Limiting Architecture for why). `POST /api/admin/security { action: "unlock_account", email }` deletes **every** lockout row for that email across all source IPs — an admin does not need to know which IP triggered the lock.

Unlocking does not reset the underlying rolling failure count in `audit_logs` — if the account is still being actively attacked, it can re-lock shortly after. If that happens repeatedly for a real user, treat it as a signal the account itself (not the lockout mechanism) needs attention — e.g. the user's email may have been leaked and is now on a credential-stuffing list.

## 4. Tuning Thresholds Without a Deploy

Every threshold in this phase is an environment variable with a sane default (see the [Configuration Guide](CONFIGURATION_GUIDE.md)). Common tuning scenarios:

- **Too many false-positive lockouts during a known legitimate traffic spike** (e.g. a tournament launch): raise `LOCKOUT_FAILURES_TO_LOCK` temporarily, or raise `EDGE_RATE_LIMIT_MAX_REQUESTS` for the affected window.
- **A specific endpoint is being hammered**: its limit is hard-coded per-function (see the Attack Matrix), not env-driven — this requires a code change and redeploy, deliberately, since per-endpoint limits were hand-tuned to that endpoint's legitimate traffic pattern and shouldn't drift via a shared env var.
- **CAPTCHA is firing too often / not often enough**: `CAPTCHA_TRIGGER_AFTER_FAILURES`.

## 5. What This Phase Does NOT Automatically Do

- Does not ban IPs or devices at the network level (no WAF integration exists in this codebase — that's Cloudflare's job, assumed but not configured here).
- Does not notify moderators in real time when a fraud flag is raised (no push/email hook on `fraud_flags` inserts) — flags are pull-based (`GET /api/admin/security`), not push-based. A moderator must check the queue.
- Does not distinguish a false-positive lockout from a genuine attack automatically — every unlock is a human decision.
- Does not detect impossible-travel logins (see Threat Model §3, explicit gap).
