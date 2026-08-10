# Phase 8.5 — Repository Audit

Read-only audit performed before any Phase 8.5 code changes, per the phase's required workflow. Every finding is classified as one of **Already Complete**, **Needs Improvement**, **Bug**, **Technical Debt**, or **Production Risk**. File:line evidence is given for every claim; this is a scoping document, not an essay — see `PHASE8_5_SECURITY_REVIEW.md`, `PHASE8_5_PERFORMANCE_REVIEW.md`, and `PHASE8_5_DATABASE_REVIEW.md` for the deeper follow-on reviews this audit scoped.

## Ground truth for this whole phase

No live Supabase project, Redis instance, or deployed infrastructure exists anywhere in this development environment — nothing in this repository's history has ever run against a real backend. This shapes every "not verified" note below and in every later Phase 8.5 document; it is not repeated at every occurrence.

## 1. Architecture

- **[Already Complete]** `apps/web` (Next.js/Node) and `supabase/functions` (Deno) are deliberately separate compilation contexts (`README.md:17`, `docs/ARCHITECTURE_MONOREPO.md`) — avoids a documented historical tsconfig cross-contamination bug.
- **[Already Complete]** Edge functions consistently split into thin `index.ts` route handlers + `_module/` logic dirs — 80 route functions, 13 shared/logic dirs.
- **[Technical Debt]** `apps/web/lib/ai`, `apps/web/lib/escrow`, `apps/web/lib/payments` are empty, checked-in directories — dead scaffolding.
- **[Needs Improvement]** `packages/shared` is genuinely empty — zero code sharing exists between the two runtimes, which is why the retention-days duplication below (finding under Supabase/Edge Functions) exists and can't be trivially deduplicated.

## 2. Database

- **[Already Complete]** RLS is enabled on all tables — verified across every `create table` in `supabase/migrations/*.sql` against every `enable row level security` statement.
- **[Already Complete]** Wallet/ledger schema is well-indexed and matches its actual query patterns.
- **[Needs Improvement]** `challenges` (`supabase/migrations/0006_games_challenges_tables.sql:81-86`) is indexed on `(status, game_id)`, `creator_id`, `opponent_id`, `tournament_id`, but `challenge-browse`'s actual public discovery query (`_challenge/workflow.ts:289-325`) also filters on `visibility`, `platform_code`, `region_code` and sorts by `created_at`/`stake_cents` — none of those are indexed. See `PHASE8_5_DATABASE_REVIEW.md` for the fix.
- **[Bug]** `moderator_actions` (`supabase/migrations/0009_dispute_moderation_tables.sql:53-69`) is a fully indexed, RLS'd, trigger-guarded table that **nothing writes to** — `_moderator/decisions.ts` records moderator decisions exclusively via `recordAudit` into `audit_logs`. Dead schema, flagged not fixed (see §"Explicitly out of scope" below).

## 3. Supabase / Edge Functions

- **[Already Complete]** 79 of 80 route functions use the `withEdgeFunction` composition uniformly; the 2 exceptions (`storage-cleanup`, `health`) and the 1 no-JWT function (`payment-webhook`) are each explicitly documented as intentional, with their own compensating auth (shared-secret bearer, no-auth-by-design, HMAC signature respectively).
- **[Technical Debt]** `storage-cleanup/index.ts:98-103` hard-codes a 365-day retention window duplicating `apps/web/lib/storage/config.ts`'s value, because the two runtimes share no module graph — already flagged in-code as "kept in sync manually," a real drift risk but not fixable without a larger shared-config mechanism this phase's "no new architecture" constraint doesn't license building.

## 4. Realtime

- **[Already Complete]** Postgres Changes + Broadcast, `domain_events` → `EVENT_RULES` dispatch table — no duplicated event logic per feature.
- **[Production Risk]** Horizontal scaling past current volume is entirely Supabase's managed-infra concern with no documented app-level fallback, and only 1 of 6 files in `apps/web/lib/realtime` has a test. See `PHASE8_5_CHAOS_ENGINEERING.md` for the realtime-disconnect scenario this motivates.

## 5. Wallet

- **[Already Complete]** Double-entry consistency is **structural**, not conventional: `postBalancedEntries()` (`_wallet/ledger.ts`) is the sole insert path (grep-verified), rejects unbalanced legs before opening a transaction, row-locks wallets in stable sorted order (deadlock prevention), and a DB-layer `DEFERRABLE INITIALLY DEFERRED` constraint trigger (`fn_validate_ledger_balance`, migration `0011_functions.sql:64-87`) re-validates at commit regardless of code path. A second trigger plus a column-privilege REVOKE make direct writes to `wallets.available_cents`/`escrowed_cents` structurally impossible. This claim is re-verified independently in `PHASE8_5_FINANCIAL_VERIFICATION.md`.
- **[Production Risk]** Escrow has no automatic release-on-timeout — documented as a known limitation since `docs/ESCROW_ARCHITECTURE.md`, still true. Funds can sit escrowed indefinitely if the non-claiming participant never acts. **Not fixed this phase** — building a timeout-release scheduler is new wallet functionality, explicitly excluded by this phase's scope. Documented as an accepted, flagged risk in the final report.

## 6. Tournament Platform

- **[Already Complete]** All four bracket formats (single/double elimination, round robin, Swiss) are implemented and unit-tested (`_tournament/bracket.ts`, `bracket.test.ts`).
- **[Bug — documentation]** `docs/TOURNAMENT-001-deliverable.md:23` (a Phase-2-era doc) still claims double-elim/Swiss/round-robin "throw not-implemented errors," contradicted by the Phase 8 implementation. Fixed in this phase (see documentation updates).
- **[Needs Improvement]** Check-in/round-timeout precision beyond pg_cron's fixed-interval granularity remains a documented, still-open limitation — same class of gap noted for realtime.

## 7. AI Platform

- **[Already Complete]** The "assistive only" boundary holds under direct inspection: `_ai/fraud-detection.ts` only ever inserts `fraud_flags` (its one `.update()` only touches reviewer/status fields on human review); `_ai/moderation-assistant.ts` has zero write calls at all.
- **[Needs Improvement]** No automated guard (lint rule, CI check) prevents a future change from adding a wallet/challenge write inside `_ai/` — the guarantee currently rests on manual review discipline. Noted as a recommendation, not built this phase (would require a new custom lint rule — judged out of proportion to the actual risk for this pass).

## 8. Frontend

- **[Production Risk]** Zero `error.tsx`/`global-error.tsx` anywhere under `apps/web/app` — no App Router error boundaries. **Fixed this phase.**
- **[Production Risk]** Zero `loading.tsx` files anywhere — no route-level loading UX. **Partially addressed this phase** (root-level boundary added; full per-route loading states judged out of scope as a UI feature, not a hardening fix).
- **[Already Complete]** Auth gating centralized in `middleware.ts`, not duplicated per-page.
- **[Needs Improvement]** `.env.local`'s placeholder `NODE_ENV=production` is a footgun for local reuse — noted, left as-is (a `.gitignore`d local file, not a shipped risk).

## 9. Authentication

- **[Already Complete]** MFA gating, admin/moderator role checks all route through canonical, previously-reviewed single-source-of-truth checks (`middleware.ts`, `is_admin()`/`is_moderator()` RPCs). No regression found.
- **[Needs Improvement]** "Remember Me" doesn't vary session lifetime (fixed 7-day refresh token regardless) — a known, documented simplification from Phase 3, not addressed this phase (would be new auth functionality, explicitly excluded).

## 10. Security

- **[Production Risk]** Zero security headers anywhere — no CSP, `X-Frame-Options`, `Strict-Transport-Security`, `X-Content-Type-Options`, no `headers()` in `next.config.ts`, no `vercel.json`. **Fixed this phase.**
- **[Already Complete]** CORS centralized (`_shared/security/origin.ts`); cookie handling inherits `@supabase/ssr`'s secure defaults.
- **[Needs Improvement]** `enforceRateLimit` is a fixed-window counter (allows burst-doubling at window boundaries) — already reviewed and explicitly scoped out in a prior phase's own documentation (`docs/SECURITY_ARCHITECTURE.md:49`). Left as accepted technical debt, consistent with that prior decision and this phase's "extend, don't rebuild" constraint.

## 11. Rate Limiting

- **[Already Complete]** Spot-checked 5 pre-Phase-7 endpoints — all have `rateLimit` configured. Coverage claim from the Phase 7/8 review holds for older endpoints too.

## 12. CI/CD

- **[Production Risk]** CI (`​.github/workflows/ci.yml`) runs format/lint/typecheck/build for both runtimes but **never runs `deno test` or `npm run test`** — the entire test suite (including the wallet-ledger and bracket tests) is currently dead weight from CI's perspective; a regression would not block a merge. **Fixed this phase.**
- **[Needs Improvement]** No build-artifact retention, no dependency cache for the Deno CI job. **Deno caching fixed this phase**; artifact retention judged low value for this project's size and left as-is.

## 13. Documentation

- **[Bug]** `README.md:10` claims 64 migrations; actual count is 105+ as of this phase. **Fixed this phase.**
- **[Bug — documentation]** `docs/TOURNAMENT-001-deliverable.md` stale claim (see §6). **Fixed this phase.**
- **[Already Complete]** All cross-references in `docs/README.md` resolve to real files; phase docs are unusually disciplined about labeling unverified claims.

## 14. Infrastructure

- **[Production Risk]** No infrastructure-as-code exists at all (no Dockerfile, Terraform, Kubernetes manifests, `vercel.json`) — every environment is presumably hand-configured through the Vercel/Supabase dashboards, with no reproducible, reviewable record. Documented as an accepted risk with mitigation guidance in `PHASE8_5_INFRASTRUCTURE_AUDIT.md` — building full IaC from scratch is judged out of proportion to a hardening pass (a genuinely large, multi-week undertaking, not a hardening-scope fix), but the deployment/config surface is fully documented so it *could* be codified later.

## 15. Monitoring

- **[Already Complete]** Structured JSON logging with auto-propagated correlation/request IDs exists for edge functions (`_shared/logger/index.ts`).
- **[Production Risk]** `SENTRY_DSN` is declared in `apps/web/lib/env.ts` but nothing consumes it — no APM/error-tracking is actually wired up anywhere, frontend or backend. **Partially addressed this phase**: a lightweight structured server-side logger added for the Next.js app (mirroring the Deno backend's approach, no new external dependency); full APM (Sentry or equivalent) requires a live account/DSN to configure and verify, which doesn't exist in this environment — documented as the concrete next step in `PHASE8_5_OBSERVABILITY_REVIEW.md` rather than installed inert.
- **[Already Complete]** `health/index.ts` provides a real DB-connectivity liveness/readiness endpoint, exempted from auth for external uptime monitors.

## 16. Testing

- **[Bug]** `_moderator/` (8 files, including the self-described "SECURITY-CRITICAL" `decisions.ts`) has zero test files.
- **[Bug]** `_admin/` (11 files, including wallet-adjustment logic) has zero test files.
- **[Needs Improvement]** `_payment/` and `_wallet/` each have only 1 test file across 9-11 source files — thin beyond the core ledger primitive.

## 17. Developer Experience

- **[Already Complete]** `npm install && npm run dev` plausibly works from a fresh clone; README setup instructions are accurate.
- **[Needs Improvement]** No `.nvmrc`/`.node-version` pinning the `engines.node >=20.11.0` constraint. **Fixed this phase.**

## Explicitly out of scope for Phase 8.5 (flagged, not built)

Per this phase's own "zero feature development" mandate, the following genuine findings are **documented as accepted risk**, not fixed, because fixing them would mean adding new functional behavior rather than hardening existing behavior:

- Escrow auto-release-on-timeout scheduler (new wallet functionality)
- Wiring `moderator_actions` into the moderation write path, or removing it (a functional decision about the moderation system, not a hardening fix — either direction changes behavior)
- User-blocking → challenge/chat RLS visibility wiring (a new authorization feature)
- A real APM/Sentry account (no live account exists to configure against; code-level readiness only)
- Rate limiter algorithm change (fixed-window → sliding-window) — already reviewed and deliberately deferred in a prior phase; this phase extends that decision rather than reopening it
