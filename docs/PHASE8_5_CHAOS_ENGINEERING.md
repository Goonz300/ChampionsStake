# Phase 8.5 — Chaos Engineering

## Method

No live Supabase project, Redis instance, or deployed environment exists in this development environment — genuine fault injection (killing a real database connection mid-request, disconnecting a real websocket) isn't possible here. For each scenario named in the brief, this review instead verified the ACTUAL code-level behavior directly against the failure mode — reading the real error-handling/retry/fallback logic rather than assuming it exists — and fixed genuine gaps found along the way. Where a scenario can only be meaningfully observed against live infrastructure, that's stated plainly rather than a result being invented.

## Scenarios

### Redis unavailable — verified, one real gap found and fixed

`_shared/security/rate-limit.ts`'s `incrementWithFallback` already had a `try/catch` around the Upstash call that falls through to a Postgres-backed counter on any thrown error — genuine, working graceful degradation for Redis *erroring*.

**Gap found**: neither Upstash fetch call had a timeout. A `try/catch` only triggers on a rejected promise — if Redis is reachable but pathologically slow (or a network partition causes a TCP hang with no RST), the fetch would simply hang, and the fallback would never engage. A rate limiter that can block on a downstream hang defeats its own purpose. **Fixed**: added `AbortSignal.timeout(2000)` to both Upstash calls, so a hang now surfaces as the same rejection the existing fallback logic already handles correctly.

### Supabase unavailable — verified (this platform's core dependency; "fallback" isn't the right question)

There is no meaningful "fallback" for the database/auth provider the entire backend is built on — that's total downtime, not a degraded mode. The real question is whether the app fails *cleanly* (clear error, bounded wait) or *badly* (hangs, corrupts data, retries forever). Verified: `_shared/transactions/index.ts`'s Postgres client sets `connect_timeout: 10` (10s) — a connection attempt during an outage fails within 10 seconds, not indefinitely. The `postgres` driver reconnects lazily on the next query once the database is back, with no special handling needed. **No fix needed** — this is already a reasonable, bounded failure mode.

### Edge Function failure — verified

Edge Functions in this architecture don't call each other over HTTP (shared logic lives in `_shared`/`_wallet`/etc. modules, imported directly, not invoked cross-function) — so "one Edge Function's failure cascading into another's" isn't a real failure mode here by construction. A single invocation failing is isolated to that one request/caller by the platform itself.

### Notification worker / Email worker failure — verified

`_realtime/delivery.ts`'s `sendPushNotification` and `enqueueEmailNotification` are each wrapped in their own `try/catch` that logs and swallows — confirmed these never propagate into `processUnhandledEvents`' own loop (`_realtime/notifications.ts`), so a push/email failure for one recipient never blocks or fails the rest of that event's fan-out, or the sweep's processing of later events. **Gap found and fixed** (same class as Redis): neither the Expo push call nor the Resend email call had a timeout — added `AbortSignal.timeout(8000)` to both, so a hung third-party doesn't tie up the invocation for its full execution budget.

### Database restart — verified (see "Supabase unavailable" above — same mechanism)

`connect_timeout: 10` bounds the reconnection attempt; the `postgres` driver's lazy reconnection means no explicit "reconnect" logic was needed or added. In-flight queries during the restart fail with a clear connection error (surfaces as a 500 to the caller, not a hang); the *next* request after the database is back succeeds without any special handling.

### Realtime disconnects — verified, existing design is correct

`apps/web/lib/realtime/useRealtimeChannel.ts` — the single hook every realtime feature in this app funnels through — explicitly delegates reconnection to the underlying `@supabase/supabase-js` Realtime client (which implements bounded, exponential-backoff reconnection internally) rather than reimplementing transport-level reconnect logic in application code. This is the *correct* choice (don't duplicate what the client library already does correctly), not a gap — corrects an imprecise phrasing in `docs/PHASE8_5_REPOSITORY_AUDIT.md`'s Realtime finding, which read as "no reconnection strategy exists" when the more accurate statement is "no *custom* reconnection strategy exists, because the standard one is already provided by the client and deliberately not reimplemented." The hook does correctly own its own scope: channel teardown on unmount and re-subscription on a changed `channelName`, preventing the subscription leaks that would actually be this codebase's responsibility.

### Webhook retries — verified, already clean (re-confirms `PHASE8_5_SECURITY_REVIEW.md`'s finding)

`payment-webhook`'s idempotency is enforced by a unique-constraint insert into `processed_payment_webhook_events` — a Paystack retry of the same event hits `23505` and returns `"duplicate"` without re-executing `verifyAndCompleteDeposit`/`finalizeWithdrawal`. Verified this holds specifically under the *retry* framing (not just the *replay-attack* framing the security review covered) — the mechanism is identical either way, since Postgres's unique constraint doesn't distinguish attacker-replay from legitimate provider-retry.

### Network latency — verified, systemic gap found and fixed across every outbound integration

**Gap found**: grepped every outbound third-party `fetch()` call in the codebase (6 total: Upstash Redis ×2, Paystack, Expo push, Resend email, plus TOR/AWS/GCP IP-range sources) — **none had a timeout**. Under real network latency or a slow/unresponsive third party, each of these could hang for the platform's full execution budget instead of failing fast into their callers' existing error handling. **Fixed all six**: `AbortSignal.timeout()` added to every one, calibrated per call site's actual sensitivity — 2s for the rate-limit backend (gates every single request, must fail fast), 15s for Paystack (a real payment operation, needs headroom) and the IP-intelligence sources (a background 6-hour sweep, less time-sensitive but still bounded), 8s for the best-effort push/email paths.

### Worker crashes — verified

Every scheduled sweep in this codebase (`_ai/trust-score.ts`, `_ai/fraud-detection.ts`, `_realtime/notifications.ts`, `_ranking/service.ts`, `_tournament/scheduling.ts`, `_wallet/reconciliation.ts`, etc.) marks work as processed *after* successfully handling it (`domain_events.processed_at`, `wallet_reconciliation_runs.completed_at`), not before — an invocation that crashes mid-sweep simply leaves the remaining rows unprocessed for the next scheduled run to pick up. No sweep holds a lock across the whole run that a crash could leave stuck (each row's processing is its own unit of work). This is a correct, self-healing design already in place — no fix needed.

## Summary of fixes made

| Scenario | Fix |
|---|---|
| Redis unavailable / network latency | `AbortSignal.timeout(2000)` on both Upstash rate-limit calls |
| Network latency (payments) | `AbortSignal.timeout(15000)` on Paystack API calls |
| Network latency (notifications) | `AbortSignal.timeout(8000)` on Expo push and Resend email calls |
| Network latency (background sweep) | `AbortSignal.timeout(15000)` on TOR/AWS/GCP IP-range fetches |

## What still needs a real environment to observe

An actual Supabase project outage, an actual Redis outage (vs. a simulated slow response), and actual sustained websocket disconnection/reconnection storms at scale are only truly observable against live infrastructure — `load-tests/k6-realtime-websockets.js` (Step 7) is the closest this suite gets to exercising the Realtime reconnection path under real load, and should be the first place to look once a staging environment exists.
