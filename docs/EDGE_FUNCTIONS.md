# ChampionsStake Edge Function Framework

This document explains the shared framework in `_shared/` that every Edge
Function is built on. **This framework contains no business logic** — no
Wallet, Escrow, Challenge, Tournament, Payment, AI, or Notification code
lives here. It is the infrastructure those future phases will build on top
of.

## Architecture

Every function's entry point is wrapped in `withEdgeFunction()`
(`_shared/middleware/compose.ts`), which handles — in this order — CORS
preflight, correlation/request ID assignment, JWT verification and profile
loading (unless `auth: "none"`), rate limiting, timing metrics, and
top-level error normalization into a standard response. Your handler
function receives a fully-populated `EdgeContext` (request, authenticated
user, their profile, correlation/request IDs) and returns a `Response` —
usually via `successResponse()`/`errorResponse()` from `_shared/response/`.

```
Request
  → CORS preflight check
  → correlation ID assignment
  → JWT verification → profile load
  → rate limit check
  → YOUR HANDLER (validate → authorize → idempotency → transaction → audit → event → respond)
  → error normalization (if anything threw)
  → CORS + security headers attached
Response
```

## Folder Structure

```
_shared/
  auth/          JWT verification (jwt.ts), profile loading (session.ts), role checks (roles.ts)
  permissions/   requirePlayer/requireVerifiedPlayer/requireModerator/requireAdministrator/requireSupportStaff
  validation/    Zod schemas (schemas.ts) + validateBody/Query/Headers/PathParams (validate.ts)
  errors/        EdgeFunctionError hierarchy + domain-error base classes future phases extend
  response/      successResponse/errorResponse/paginatedResponse/streamingResponse
  logger/        structured JSON logging with per-invocation context
  audit/         recordAudit() — wraps the existing fn_write_audit_log (DB-002)
  events/        emit() — durable event log (domain_events table), NOT in-memory pub/sub (see below)
  idempotency/   beginIdempotentRequest/completeIdempotentRequest/failIdempotentRequest
  database/      Supabase client factories + generic Repository base class
  transactions/  withTransaction (real Postgres BEGIN/COMMIT) + withRetry
  security/      headers.ts, origin.ts (CORS), replay.ts, signed-requests.ts (HMAC), rate-limit.ts
  metrics/       recordLatency/recordErrorMetric/recordCounter, withTiming
  config/        the ONE place environment variables are read
  middleware/    compose.ts — the withEdgeFunction wrapper itself
  utils/         correlation ID helpers
_template/       copy this directory to start a new function
```

## How to Create a New Function

1. Copy `_template/` to `supabase/functions/your-function-name/`.
2. Replace `requestBodySchema` with your real input schema.
3. Replace the body of `handler()` — keep the shape (authorize → validate →
   idempotency-if-mutating → transaction-if-multi-step → audit → event →
   respond), delete whichever pieces genuinely don't apply (a read-only GET
   endpoint doesn't need idempotency, for instance).
4. Set the right `auth` option: `"required"` (default) for normal
   user-facing endpoints, `"optional"` for endpoints with a public browsing
   mode, `"none"` for webhook/cron-triggered functions that authenticate via
   `security/signed-requests.ts` instead of a user JWT.
5. Choose the right `requireX()` permission call for your endpoint's
   minimum privilege level.

## Best Practices

- **Never read `Deno.env.get()` outside `_shared/config/index.ts`.** Add a
  new config field there instead, so every environment variable name and
  default lives in one place.
- **Never call the Supabase REST client and expect a transaction across
  multiple `.from()` calls** — each one is its own request. Use
  `withTransaction()` for real multi-statement atomicity, or better, push
  the logic into a single Postgres function (RPC) when possible, since that
  is atomic per call with no connection-pool concerns at all.
- **Always validate with Zod before touching business logic.** `_shared/
  validation/validate.ts`'s helpers throw a consistent `ValidationError` —
  never let a raw Zod error or a raw `JSON.parse` `SyntaxError` escape to
  the client.
- **Any endpoint that moves money or could be double-submitted needs
  `Idempotency-Key` handling.** Copy the pattern from `_template/index.ts`.
- **Authorization checks belong in `permissions/`, reusing `profile.role`/
  `profile.status`/`profile.kyc_status`** — don't duplicate the DB-002
  Postgres helper functions' logic in TypeScript; if a check genuinely needs
  to query relationship data (e.g. "is this user a participant in this
  specific challenge"), call the existing Postgres RPC (`is_challenge_participant`,
  etc.) rather than re-deriving the rule here.

## Security Model

- **service_role bypasses RLS** (`database/client.ts`'s `getServiceRoleClient()`)
  — Edge Functions are the trusted "system" actor (Architecture §8), but
  bypassing RLS is not the same as skipping authorization. Every function
  using the service-role client is still responsible for checking the
  calling user is allowed to do what they're asking, exactly as
  `lib/storage/service.ts` does in the Next.js app (STORE-001) by calling
  the same DB-002 helper functions via RPC against the user's own JWT.
- **CORS** is computed per-request against an explicit allow-list
  (`security/origin.ts`), never a wildcard.
- **Webhook/cron-triggered functions** (no user JWT at all) authenticate via
  HMAC signature verification (`security/signed-requests.ts`) — see
  STORE-001's `storage-cleanup` function for the existing real-world example
  this pattern was generalized from.
- **Replay protection** (`security/replay.ts`) reuses the `idempotency_keys`
  table (an unseen nonce is, by definition, a first-use idempotency key) —
  a deliberate reuse rather than a third near-identical table.

## Event Bus — Read This Before Using It

`events/index.ts`'s `emit()` is **not** a traditional in-memory pub/sub.
Edge Functions are stateless, isolated-per-invocation processes; handlers
registered in one invocation do not exist in the next. `emit()` durably
writes to the `domain_events` table (migration 0034) — that table is the
actual "bus." A future consumer (a scheduled job, a Postgres trigger, or a
Realtime subscription on that table) is what does real fan-out, not an
in-process subscriber list. `onWithinRequest()` exists only for
same-invocation side effects and must never be relied on for anything that
needs to survive past the current request.

## Lifecycle

1. Request arrives → CORS preflight handled if `OPTIONS`.
2. Correlation ID extracted or generated; log context set for the rest of
   the invocation.
3. JWT verified (if required/optional) → profile loaded → rate limit
   checked.
4. Your handler runs: validate → authorize → (idempotency check) →
   (transaction) → audit → event → respond.
5. Any thrown error (yours or the framework's) is normalized to a standard
   error response via `toEdgeFunctionError()`.
6. CORS + security headers attached to whatever response resulted; log
   context cleared.

## Known Limitations (documented, not silently assumed away)

- **No live Deno runtime was available while building this phase** (this
  container has no `deno` binary and no network access to install one or
  fetch `npm:`/`jsr:` dependencies on first run). Every file was checked for
  balanced brackets/braces programmatically, and cross-referenced for
  consistent imports, but `deno test` and `deno check` still need to be run
  for real in an environment with Deno + network access before this is
  production-verified.
- **The Postgres-fallback rate limiter is O(n) per check** (it counts
  matching rows in `domain_events`) — fine for login-scale traffic, not
  recommended for a high-frequency endpoint. Configure `UPSTASH_REDIS_URL`/
  `UPSTASH_REDIS_TOKEN` for anything beyond light traffic.
- **"Future API Client" and "Service Role" permission levels** are
  documented in `permissions/index.ts` but not implemented as profile-based
  checks — service_role is a credential, not a profile row, and Future API
  Client needs a schema (API keys/OAuth clients) that doesn't exist yet
  (same deferral AUTH-001 and STORE-001 already documented for it).
