# Phase 8.5 — Observability Guide

## Backend (Deno Edge Functions) — already complete

`supabase/functions/_shared/logger/index.ts` provides structured JSON-line logging with correlation/request ID auto-propagation (`setLogContext`, called once per invocation by `_shared/middleware/compose.ts`, so every subsequent log line in that invocation includes it without call sites passing it explicitly). No changes needed — confirmed still correct during this phase's audit.

`health/index.ts` provides a real liveness/readiness endpoint (DB connectivity check, 3s timeout), exempted from auth so external uptime monitors can reach it even if auth infrastructure itself is degraded.

Audit logging (`_shared/audit/index.ts`, `audit_logs` table) covers every privileged mutation across every phase — this is operational/compliance visibility, distinct from application logs, and was not gap-checked further this phase (already deeply reviewed in Phase 7/8's hostile review).

## Frontend (Next.js) — fixed this phase

**Gap found** (Step 1 audit): no structured-logging module existed for the Next.js app at all — every server-side log was a plain `console.error("message", errorObject)` call, unstructured and inconsistent in shape between call sites.

**Fixed**: `apps/web/lib/logger.ts` — a structured JSON-line logger matching the backend's output shape (`level`, `message`, `timestamp`, plus caller-supplied context). Deliberately **not** a direct port of the backend's design: the backend's global mutable `LogContext` is safe there because each Deno Edge Function invocation gets its own isolated execution context, but Next.js on Node.js can serve multiple concurrent requests within the same process — a shared mutable "current request" object would leak request A's context into request B's log lines under real concurrent load. The frontend logger instead takes context as an explicit parameter on every call; there's nothing shared to leak.

Migrated as a demonstration of the pattern (not a full sweep of every `console.error` call site in the app — see "Recommended follow-up" below): `lib/auth/lockout.ts`, `lib/security/captcha.ts`. Both are security-relevant fail-open paths where structured context (which account, which error) genuinely matters for incident response.

**Also found and fixed while touching `captcha.ts`**: the Cloudflare Turnstile verification call had no timeout — the same class of gap `docs/PHASE8_5_CHAOS_ENGINEERING.md` found and fixed across six backend outbound calls, just frontend-side and missed by that pass's backend-scoped grep. Added `AbortSignal.timeout(8000)`, matching the other best-effort third-party calls' calibration.

## APM / error tracking — declared, not wired (documented, not built)

`apps/web/lib/env.ts` declares `SENTRY_DSN` as an optional env var, but nothing in the codebase consumes it — no `@sentry/*` package is installed, no initialization code exists anywhere. The env schema anticipates an APM integration that was never actually built.

**Not wired this phase**: installing `@sentry/nextjs` (or an equivalent) and configuring it requires a live Sentry (or similar) account and DSN to initialize against and verify — neither exists in this development environment, and shipping an SDK that's never been confirmed to actually capture and report an error would be worse than not shipping it (false confidence). This is exactly the class of thing this phase's own methodology treats honestly rather than fabricating.

**Concrete next step for a real deployment**:
1. Create a Sentry project (or equivalent APM) for the staging/production environment.
2. `npm install @sentry/nextjs --workspace=apps/web` and run its setup wizard (`npx @sentry/wizard@latest -i nextjs`), which generates `sentry.client.config.ts`/`sentry.server.config.ts`/`sentry.edge.config.ts` and wires `next.config.ts` automatically.
3. Set `SENTRY_DSN` (already declared in `lib/env.ts`) in the real deployment environment.
4. Route `apps/web/lib/logger.ts`'s `error()` calls into `Sentry.captureException`/`Sentry.captureMessage` alongside the existing structured console output — additive, not a replacement (structured console logs remain useful for log-drain search independent of Sentry's own UI).
5. Verify end-to-end by deliberately triggering a test error against the deployed staging environment and confirming it appears in Sentry before considering this integration complete — "installed" and "verified working" are different claims, and only the second one should be treated as done.

## Metrics, tracing, dashboards, alerting

No metrics/tracing infrastructure (Prometheus, OpenTelemetry, Grafana) exists in this codebase, and none was added this phase — building a full metrics pipeline is new infrastructure, not a hardening fix, and Supabase's own dashboard already provides basic database/function-invocation metrics without this platform needing to build a parallel system. `docs/PHASE8_5_MONITORING_GUIDE.md` documents what to watch using Supabase's existing dashboard plus the structured logs this phase confirmed/improved, rather than proposing a new stack to operate.

## Recommended follow-up (not done this phase, explicitly out of scope)

- Migrate the remaining frontend `console.error` call sites (`lib/auth/device.ts`, `lib/auth/rate-limit.ts`, `lib/auth/security-notifications.ts`, `app/api/auth/register/route.ts`) to `lib/logger.ts` — mechanical, low-risk, but touches several security-critical files with existing passing tests; deferred to keep this phase's diff reviewable rather than a sweeping rename across files whose current behavior is already correct.
- A lint rule (or a custom ESLint rule, mirroring the `no-console` restriction already in place) that prevents a future PR from adding a new raw `console.error` call outside `lib/logger.ts`, closing the gap permanently rather than by convention.
- Real Sentry (or equivalent) wiring, per the concrete steps above, once a live project exists to configure against.
