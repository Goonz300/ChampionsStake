# Rate Limiting Architecture — Phase 5

## 1. Two Independent Rate-Limiting Systems (Deliberate, Not Duplicate)

ChampionsStake has two rate-limiting implementations, each pre-dating or extended by this phase, and each documented as intentional in its own source:

| | Web app (Next.js) | Edge Functions (Deno) |
|---|---|---|
| File | `apps/web/lib/auth/rate-limit.ts` | `supabase/functions/_shared/security/rate-limit.ts` |
| Backend | Postgres (`audit_logs`) only | Upstash Redis, Postgres fallback |
| Algorithm | Windowed COUNT query | Fixed-window INCR/EXPIRE |
| Covers | login, MFA verify, register, forgot/reset-password, MFA enroll | every `withEdgeFunction`-based route |
| Why two | `audit_logs`-backed suffices for auth's request volume; Edge Functions carry the platform's high-frequency traffic (chat, presence, gaming) and need Redis | — |

Why not unify them: the web app's login limiter's fail-open behavior, its exact audit trail shape, and its coupling to Supabase Auth's own session lifecycle are all specific to auth flows and pre-date this phase by multiple phases. Rebuilding it on the Edge Function limiter would be a redesign of authentication, explicitly out of scope for this phase.

## 2. Edge Function Limiter — Backend Selection

```
enforceRateLimit(options) → incrementWithFallback(key, windowSeconds)
  if config.redis.isConfigured:
    try UpstashBackend.increment(...)
    catch → log, fall through to PostgresFallbackBackend.increment(...)  [RUNTIME fallback]
  else:
    PostgresFallbackBackend.increment(...)                              [config-time fallback]
```

Both implement the same `increment(key, windowSeconds): Promise<count>` contract. Neither requires a persistent connection — Upstash via its REST API, Postgres via the existing Supabase client — which is what makes genuine (not stubbed) Redis-backed limiting possible inside a stateless Deno Edge Function.

**Hostile-review fix**: the backend choice used to be config-time-only (decided once by whether env vars were set, never revisited). Layer 2's global-default rate limit means every Edge Function request now goes through this path, so an uncaught Upstash failure would 500 the entire platform, not just a handful of explicitly rate-limited endpoints. `incrementWithFallback` now catches an Upstash failure and falls back to the Postgres backend for that single check, matching the brief's own "fallback to database if Redis unavailable" requirement as a genuine runtime behavior. Tradeoff: during an Upstash outage, the counted series for a given key briefly diverges (Postgres counts different underlying events than Redis was tracking) — favoring availability over perfectly continuous counting during the outage, consistent with every other fail-open decision in this phase.

**Known inaccuracy, corrected here**: the module's own header comment previously claimed "sliding-window." The actual implementation (INCR + EXPIRE-on-first-increment) is a classic **fixed window**, which allows up to 2x the configured rate at a window boundary (e.g. a burst just before and just after the boundary). This was not silently left — it's flagged so a future phase can decide whether the boundary-burst tolerance matters enough to justify a genuine sliding-window or token-bucket rewrite for the highest-risk endpoints (login, MFA, withdrawal).

## 3. Algorithm Choice by Endpoint Class

| Class | Algorithm | Rationale |
|---|---|---|
| Auth (login, MFA, register, password reset) | Fixed window + progressive delay + lockout (three layered controls) | The layering compensates for fixed-window's boundary-burst weakness — even a boundary burst still accumulates toward lockout |
| Financial (withdraw, transfer, adjustment) | Fixed window, tight limits (5–20/min) + velocity flag | Low legitimate volume; a 2x boundary burst is still small in absolute terms |
| Gaming (challenge/tournament create, chat, typing) | Fixed window, per-function tuned | Established pre-Phase-5 pattern, unchanged |
| Read/browse endpoints | Fixed window, generous (60/min) | Low risk, optimizing for false-positive avoidance |
| Global default (anything without an explicit config) | Fixed window, `EDGE_RATE_LIMIT_WINDOW_SECONDS`/`MAX_REQUESTS` | Closes the "no protection at all" gap this phase's audit found |

## 4. Distributed Operation (Layer 12)

Upstash Redis's REST API means every Edge Function instance shares the same counters without any instance-local state — this is inherently "distributed" without extra work, since Deno Edge Functions are already stateless per-invocation. Horizontal scaling requires no code change; it requires only that `UPSTASH_REDIS_URL`/`UPSTASH_REDIS_TOKEN` be set in the deployed environment (currently unset in this sandbox — verified, not assumed, by grep for any `.env` file). Without them, every instance falls back independently to the Postgres backend, which IS globally consistent (shared Postgres), just slower and with unbounded `domain_events` growth (no TTL/sweep on `RateLimitProbe` rows — a known operational gap, see the Operational Runbook).

## 5. Database Protection (Layer 11) — Reconciliation, Not New Constraints

Three pre-existing mechanisms already protect money-moving idempotency; this phase reconciled and documented them rather than adding a fourth:

1. **`idempotency_keys`** (generic, client-supplied `Idempotency-Key` header): `wallet-transfer`, `challenge-accept/cancel/publish/release`, `tournament-register`, `chat-send`.
2. **`processed_payment_webhook_events`** unique `(provider, provider_event_id)`: Paystack webhook idempotency, enforced by the DB constraint (insert-then-check-23505), not a pre-check race.
3. **Structural 1:1 uniqueness**: `escrow.challenge_id`/`escrow.tournament_id` are each `UNIQUE`, which is what prize distribution (`triggerPrizeDistribution` in `_tournament/workflow.ts`) inherits — it explicitly reuses the same `releaseEscrow` primitive as challenge settlement rather than having its own, separately-governed payout path. Verified by reading `_tournament/workflow.ts`'s own comment before writing this document, not assumed.

No new migration was needed here: the audit's initial impression of "split across three mechanisms" turned out, on closer reading, to be three mechanisms each correctly scoped to a different concern (generic request replay, provider webhook replay, and one-settlement-per-challenge/tournament) rather than three competing implementations of the same thing.

## 6. Endpoint Coverage

See [ATTACK_MATRIX.md](ATTACK_MATRIX.md) for the full per-endpoint table (limit, window, key basis) across both runtimes.
