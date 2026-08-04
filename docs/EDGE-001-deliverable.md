# EDGE-001 — Shared Edge Function Framework

## 1. Framework Overview

Every future Edge Function wraps its handler in `withEdgeFunction()`, which composes JWT verification, profile loading, rate limiting, timing metrics, and error normalization around it (full pipeline diagram in `EDGE_FUNCTIONS.md`). The framework contains zero business logic — no Wallet/Escrow/Challenge/Tournament/Payment code exists anywhere in it — but every piece those future phases will need (idempotency, transactions, audit, events, permissions) is real, working infrastructure, not a stub.

## 2. Folder Structure

Exactly the 16 folders specified in the brief, all under `supabase/functions/_shared/`, plus `_template/` (a working example function) — full listing in `EDGE_FUNCTIONS.md`.

## 3. Shared Libraries

`config` (single source for all env vars), `errors` (10 classes: the 7 explicitly named plus `EdgeFunctionError`'s base + `IdempotencyConflictError`), `response` (success/error/paginated/streaming/no-content builders), `logger` (structured JSON with per-invocation context), `audit` (wraps DB-002's existing `fn_write_audit_log` rather than reinventing an audit trail), `events` (durable `domain_events` log — see the honesty note below), `idempotency` (generic, backed by a new `idempotency_keys` table), `database` (Supabase client factories + a generic `Repository<T>` base class), `transactions` (real Postgres `BEGIN`/`COMMIT` via a pooled direct connection, + exponential-backoff retry).

## 4. Middleware

`_shared/middleware/compose.ts`'s `withEdgeFunction()` — the one wrapper every function's `Deno.serve()` call should use. Handles CORS preflight, correlation ID propagation, auth (`required`/`optional`/`none`), rate limiting, metrics timing, and converts any thrown error (including framework errors and anything a future business-logic phase throws) into the standard error response shape.

## 5. Utilities

`utils/correlation.ts` — correlation/request ID generation and propagation, so a single user action can be traced across the Next.js app, an Edge Function, and the Postgres triggers it fires, all sharing one ID.

## 6. Base Edge Function Template

`_template/index.ts` — a real, composable example (an "echo" endpoint, deliberately trivial so it's obviously not business logic) demonstrating every framework piece wired together in the order a real function should use them: authorize → validate → idempotency-check → transaction → audit → event → respond.

## 7. Tests

5 Deno test files (`errors.test.ts` — 10 cases, `signed-requests.test.ts` — 4 cases covering the HMAC roundtrip and tamper/wrong-secret detection, `validate.test.ts` — 9 cases, `permissions.test.ts` — 10 cases covering every role/status combination including "suspended overrides role", `correlation.test.ts` — 3 cases). Idempotency and database-layer logic are not unit-tested here since they require a live Postgres connection — that's flagged as an integration-test gap in `EDGE_FUNCTIONS.md`, not silently skipped.

## 8. Documentation

`EDGE_FUNCTIONS.md` — architecture, folder structure, how to create a new function, best practices, security model, full lifecycle, and an explicit "Known Limitations" section (the event bus's real nature, the Postgres rate-limit fallback's scaling ceiling, the two unimplemented permission levels).

## 9. Verification Checklist

- [x] All 16 requested `_shared/` folders created, each with real (non-stub) content
- [x] Zero business logic anywhere in the framework — verified by re-reading every file for Wallet/Escrow/Challenge/Tournament/Payment-specific terms; the only domain-shaped names present are the *base error classes* future phases will extend (`WalletError`, `EscrowError`, etc.), which throw nothing themselves
- [x] Every new file passes a string-literal-aware bracket-balance check (the naive version flagged one false positive from a deliberately-malformed-JSON string in a test — confirmed as a false positive, not a real bug, using a corrected checker)
- [x] Two schema additions (`idempotency_keys`, `domain_events`) are both generic — no column references a specific business domain — and both have RLS enabled with zero policies, so only `service_role` can ever touch them
- [x] The event bus's non-in-memory nature is documented in three places (the module's own header comment, the migration's table comment, and `EDGE_FUNCTIONS.md`) rather than risking a future developer assuming it works like a normal pub/sub
- [x] Rate limiting has two backends (Upstash when configured, Postgres fallback otherwise) so the framework works in local dev without requiring Redis, with the tradeoff explicitly documented
- [ ] **Not verified in this environment**: no Deno runtime and no network access were available in this container (confirmed: `deno --version` returns "not found"), so none of the 5 test files or the `_template` function have actually been executed. Every file was checked for syntactic/structural consistency (bracket balance, cross-referenced imports against what each module actually exports), but `deno check` and `deno test` still need to run for real before this is production-verified — same category of limitation as every prior phase's `npm install`.

## 10. Production Readiness Summary

**Ready:** error handling, validation, response shaping, permissions, audit, and the middleware composition pipeline are complete, internally consistent, and reuse existing DB-002 infrastructure rather than duplicating it.

**Needs a decision before heavy production traffic:** the Postgres-fallback rate limiter (fine for light traffic, not for high-frequency endpoints — Upstash should be provisioned before Wallet/Challenge phases go live, since those are exactly the high-frequency endpoints Architecture §7 anticipated Redis for).

**Needs live verification:** everything in this framework needs `deno check`/`deno test` run against a real Deno + Supabase environment (impossible here — no network) before the next phase builds on top of it with full confidence.

## Stop point

EDGE-001 is complete. Per your instruction, stopping here — not implementing Wallet, Escrow, Challenges, Payments, AI, Notifications, or Tournaments until you approve.
