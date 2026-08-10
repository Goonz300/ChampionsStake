# Phase 8.5 — Release Candidate Design

This is the production-readiness plan built from the Step 1 audit (`PHASE8_5_REPOSITORY_AUDIT.md`). For each pillar: why it matters for this specific platform (a real-money competitive gaming marketplace), what state it's in today, and what this phase will actually do about it. "Will not build" items are stated as deliberately as "will build" ones — this phase's own mandate is hardening, not new features, and pretending to build something inert (an unconfigured APM, a load-test that can't run) would be worse than being honest about the limit.

## Security

**Why**: real money moves through this platform (entry fees, prize pools, withdrawals). A security defect here isn't a UX bug, it's a direct financial loss vector — Phase 7/8's own hostile review already found and fixed two Critical fund-manipulation bugs, which is the strongest evidence this class of risk is real, not hypothetical.

**Plan**: a dedicated, code-level hostile review (Step 5) covering the full attack surface named in this phase's brief, classified by severity/impact/likelihood with a fix and regression test per genuine finding. Dependency-level security (Step 3, already done) closes the two Critical CVEs found in `next`/`vitest`. Security headers (CSP, HSTS, X-Frame-Options, X-Content-Type-Options — currently entirely absent, a real gap) will be added as part of the hostile-review fix pass.

## Performance

**Why**: tournament brackets, leaderboards, and the wallet ledger are the platform's highest-traffic, highest-consequence read/write paths. Phase 7/8 already found and fixed several N+1 patterns and missing indexes in the newer subsystems; this phase's Step 6 extends that same discipline to whatever's left, plus the frontend rendering side (Server Components, caching) that hasn't had a dedicated pass yet.

## Scalability

**Why**: this codebase has never run against real traffic. The honest state is: the architecture (stateless Edge Functions, Supabase-managed Postgres/Realtime, Redis-with-Postgres-fallback rate limiting) is *designed* to scale horizontally, but nothing in this environment can prove it will at the specific volumes named in this phase's brief (100k users, 50k websockets, etc.).

**Plan**: build the actual load-test harness (Step 7) as a runnable deliverable against a real staging environment, since that's the only way this claim can ever be verified — and say so plainly rather than fabricating numbers. Document realistic scaling levers (connection pooling, Realtime's documented connection limits, read-replica options) in `PHASE8_5_SCALING_GUIDE.md`.

## Infrastructure

**Why**: no infrastructure-as-code exists at all (Step 1 finding) — every environment is hand-configured. This is a genuine risk (no reviewable diff history for config changes) but rebuilding it as Terraform/equivalent is a multi-week undertaking, not a hardening-pass fix.

**Plan**: document the full manual configuration surface exhaustively (`PHASE8_5_INFRASTRUCTURE_GUIDE.md`) so it's at least reviewable and could be codified later without rediscovery work — this is the proportionate response given the constraint against large new architecture.

## Deployment

**Why**: `PHASE7_8_DEPLOYMENT_GUIDE.md` already exists from the prior phase but is scoped to Phase 7/8's own changes. A release-candidate-level deployment guide needs to cover the whole system's first real production deploy, including the "first live run ever" risk this environment's total lack of a live instance creates.

**Plan**: `PHASE8_5_DEPLOYMENT_GUIDE.md`, extending (not replacing) the Phase 7/8 one, with an explicit go-live checklist.

## Observability

**Why**: structured logging with correlation IDs exists for the backend (`_shared/logger`); nothing equivalent exists for the frontend, and `SENTRY_DSN` is declared but never consumed anywhere (Step 1 finding) — a real, silent gap between what the config *implies* is monitored and what actually is.

**Plan**: Step 11 adds a lightweight structured server-side logger for the Next.js app (mirroring the backend's approach, no new external dependency) and documents the concrete steps to wire real APM (Sentry or equivalent) at deploy time, since no live account exists here to configure and verify one.

## Reliability & Disaster Recovery

**Why**: zero React error boundaries exist anywhere in the frontend (Step 1 finding) — an unhandled render error currently falls through to Next's generic default with no app-specific recovery. Disaster recovery for the *database* is entirely Supabase's managed responsibility (point-in-time recovery, automated backups) — this platform has never had to build its own backup mechanism, and shouldn't start now.

**Plan**: add root-level `error.tsx`/`global-error.tsx`/`loading.tsx` boundaries (concrete reliability infrastructure, not a new feature). Document Supabase's actual backup/PITR capabilities and this platform's specific recovery procedure (which migrations to reapply in what order, how to verify ledger integrity post-restore) in `PHASE8_5_DISASTER_RECOVERY_GUIDE.md`, rather than building a redundant backup system.

## Backups

**Why**: covered under Disaster Recovery above — Supabase-managed Postgres includes automated backups and PITR on paid tiers; this is a configuration/verification concern, not a code concern.

**Plan**: documented in `PHASE8_5_DISASTER_RECOVERY_GUIDE.md` with the specific settings to confirm are enabled before go-live.

## Monitoring & Alerting

**Why**: a `health` endpoint already exists and checks real DB connectivity (Step 1 finding, already complete) — the gap is everything *upstream* of "is it up" (error rates, latency percentiles, financial-anomaly alerts).

**Plan**: `PHASE8_5_MONITORING_GUIDE.md` documents what to alert on and why (e.g., "an unbalanced ledger entry should page someone immediately, not wait for a daily report" — given the ledger's structural balance guarantee, any alert firing here indicates either an attack or a genuine bug, both urgent) — the alerting *rules* are documented since there's no live monitoring stack in this environment to actually wire them into.

## Chaos Testing

**Why**: the rate-limiting layer already has a documented Redis-with-Postgres-fallback pattern (Step 1 finding) — i.e., *some* chaos resilience is already built and just needs to be verified, not invented. Other dependencies (Supabase itself, the notification/email workers) have no documented failure-mode behavior at all.

**Plan**: Step 8 designs concrete failure scenarios and verifies the code-level behavior wherever it's testable without a live environment (e.g., confirming the Redis fallback path is actually reachable in code, not just claimed in a comment), and clearly marks which scenarios need a real staging environment to observe (e.g., an actual Supabase outage).

## Release Process, Incident Response, Rollback Strategy

**Why**: this phase itself follows a strict release process (branch → audit → fix → validate → hostile review → merge gate → merge), which is worth codifying as the *standard* process for future changes, not a one-off. Incident response and rollback need to account for this platform's specific risk profile (financial data, tournament state mid-bracket).

**Plan**: `PHASE8_5_RELEASE_CHECKLIST.md`, `PHASE8_5_INCIDENT_RESPONSE_GUIDE.md` (extends `docs/INCIDENT_RESPONSE_GUIDE.md`/`_PHASE6.md` rather than replacing them), and a rollback strategy documented directly against this codebase's actual commit/migration structure (every migration has a paired `.down.sql`; every feature-branch commit is an independently-revertable logical unit).

## Secrets Management & Configuration Management

**Why**: already centralized correctly (`_shared/config`, `apps/web/lib/env.ts`) — Step 1 found no scattered secret access. The gap is documentation of *which* secrets exist and their rotation posture, not the code pattern itself.

**Plan**: documented in `PHASE8_5_INFRASTRUCTURE_GUIDE.md` and `PHASE8_5_SECURITY_GUIDE.md` — no code change needed, the existing pattern is sound.

## Scaling Strategy, Load Testing, Stress Testing

**Why/Plan**: see Scalability above. Step 7 delivers the actual runnable load-test scripts (k6 or equivalent) for every scenario named in this phase's brief, with the honest caveat that execution requires a live environment this development session doesn't have.

## Long-running Tournament Testing

**Why**: a bracket that spans days (real tournaments do) exercises season rollover, scheduled reminders, and escrow-hold duration in ways a fast unit test can't. This is functionally a chaos/load-testing concern specific to this platform's domain, not a generic load test.

**Plan**: covered by Step 10's tournament correctness verification (bracket completion, league/season rollover, forfeit/refund/cancellation across every format) via code review plus targeted tests, and noted in the load-testing harness (Step 7) as a scenario needing real elapsed time (or time-travel test infrastructure this phase doesn't build) to observe for real.

## Wallet Reconciliation

**Why**: this is the platform's single highest-consequence correctness property. Already structurally enforced in code (Step 1 finding, re-verified Step 4) — Step 9 is the dedicated, adversarial re-verification of that claim plus reconciliation query deliverables for ops to run against real data.

## Realtime Resilience, Notification Reliability

**Why**: Step 1 found only 1 of 6 realtime-related frontend files has a test, and no documented client-side reconnection/backoff strategy. Notification delivery already has a documented "fail open" pattern for several checks (captcha, rate-limit) but realtime-specific failure modes weren't reviewed.

**Plan**: covered in Step 8 (chaos scenarios: realtime disconnects, notification/email worker failure) and documented in `PHASE8_5_MONITORING_GUIDE.md`/`PHASE8_5_OPERATIONS_MANUAL.md`.

## Documentation, Testing Strategy, Developer Experience

**Why**: this phase's own Step 12 mandate is a full production-documentation set; testing strategy needs to be explicit about this codebase's real boundary (DB-client-free pure functions get direct unit tests; anything touching a live database is verified by code reading, since no live instance exists here) rather than pretending broader coverage exists.

**Plan**: Step 12 delivers all 15 named documents. `.nvmrc` (Step 3, done) and the CI test-execution fix (Step 3, done) are the concrete DX/testing-strategy fixes from this phase; `PHASE8_5_DEVELOPER_GUIDE`-equivalent content is folded into the existing `README.md` and `docs/README.md` rather than yet another top-level file, since those already serve that purpose well (Step 1 confirmed DX is already largely in good shape).
