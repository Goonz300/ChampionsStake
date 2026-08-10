# Phase 8.5 — Production Checklist

Go/no-go items before a real public launch. Distinct from `docs/PHASE8_5_RELEASE_CHECKLIST.md` (which governs merging a *change* into the main branch) — this checklist governs whether the *system as a whole* is ready for real users and real money.

## Infrastructure

- [ ] Live Supabase project provisioned (staging validated first, per `docs/PHASE8_5_DEPLOYMENT_GUIDE.md`).
- [ ] All 107 migrations applied and verified (`supabase migration list`).
- [ ] Every cron job's `pg_net.http_post` target URL and Vault secret verified against the real project (not left as migration-authored placeholders — see the deployment guide's explicit warning that these were never validated against a live project).
- [ ] Point-in-Time Recovery enabled if the plan tier supports it (`docs/PHASE8_5_DISASTER_RECOVERY_GUIDE.md`).
- [ ] Every environment variable in `docs/PHASE8_5_INFRASTRUCTURE_GUIDE.md`'s reference set with real values, not placeholders.

## Security

- [ ] `docs/PHASE8_5_SECURITY_REVIEW.md`'s findings all fixed or explicitly accepted (all were fixed this phase — confirm no regression before launch).
- [ ] `docs/PHASE7_8_SECURITY_REVIEW.md`'s findings all fixed or explicitly accepted (same — the season-reward-minting and team-ownership-hijack Critical fixes especially, re-verify these specific paths).
- [ ] One-time git-history secret scan performed (see `docs/PHASE8_5_SECURITY_GUIDE.md`) — not yet done as of this phase.
- [ ] Security headers confirmed live on the real deployed frontend (`curl -I`, not just "the code exists").
- [ ] Cookie `Secure` flag confirmed on the real deployed frontend.

## Financial integrity

- [ ] `docs/PHASE8_5_FINANCIAL_VERIFICATION.md`'s SQL queries run against the live database and return zero rows (a fresh database trivially passes; run again after the smoke test below has generated some real transactions).
- [ ] Wallet reconciliation sweep confirmed actually running on schedule (check `wallet_reconciliation_runs` after 24h live).
- [ ] Disaster recovery drill performed at least once (`docs/PHASE8_5_DISASTER_RECOVERY_GUIDE.md`) — RTO/RPO numbers measured, not assumed.

## Performance / scale

- [ ] `load-tests/` (Step 7) run against staging at least once — see `docs/PHASE8_5_LOAD_TESTING.md`. **Not yet done as of this phase** — no live environment existed to run it against during development.
- [ ] Realtime connection ceiling measured for the actual plan tier (`load-tests/k6-realtime-websockets.js`), and expected launch concurrent-user count confirmed to be comfortably under it.
- [ ] Postgres connection pool headroom confirmed under the load test's concurrency, not just assumed adequate.

## Observability

- [ ] Real APM (Sentry or equivalent) wired and verified capturing a deliberately-triggered test error (`docs/PHASE8_5_OBSERVABILITY_GUIDE.md`'s concrete steps) — **not yet done**, no live account existed during development.
- [ ] Alert rules from `docs/PHASE8_5_MONITORING_GUIDE.md`'s Tier 1 list actually configured in a real alerting system, not just documented as "should alert on this."
- [ ] `health` endpoint confirmed reachable by an external uptime monitor.

## Functional smoke test (post-deploy, real accounts)

- [ ] Full user journey: register → verify email → MFA enroll → login.
- [ ] Wallet: deposit (or test-mode equivalent) → balance reflects correctly.
- [ ] Challenge: create → accept → play → complete → funds settle correctly.
- [ ] Tournament: organizer creates → players register → bracket generates → complete a round → prize distributes correctly.
- [ ] Team: create → invite → accept → transfer ownership (confirm the *correct* account ends up as owner, re-verifying the Critical fix from `docs/PHASE7_8_SECURITY_REVIEW.md`).
- [ ] League/season: create → start season → end season → reward distributes to the correct amount (re-verifying the other Critical fix from the same doc).
- [ ] Moderation: open a dispute → moderator claims it → a *different* moderator confirms they cannot act on it (re-verifying this phase's High-severity fix) → assigned moderator resolves it correctly.

## Known, accepted gaps at launch (documented, not blocking)

These are real findings from this phase's reviews, deliberately left open because closing them requires new functional decisions this hardening phase's mandate excludes — launching with them is a conscious choice, not an oversight:

- Escrow has no automatic release-on-timeout (`docs/PHASE8_5_REPOSITORY_AUDIT.md`).
- Suspending a player/organizer mid-tournament doesn't update the bracket (`docs/PHASE8_5_TOURNAMENT_CORRECTNESS.md`).
- `moderator_actions` is dead schema (`docs/PHASE8_5_DATABASE_REVIEW.md`).
- `next`/`postcss`/`sharp` residual CVEs, closable only via a `next@16` major migration (`docs/PHASE8_5_INFRASTRUCTURE_AUDIT.md`).

**Before checking this box, confirm each of these has been explicitly acknowledged by whoever is making the launch decision** — this checklist's job is to make sure nobody launches unaware of them, not to silently carry them forward.

- [ ] All known gaps above explicitly acknowledged by the launch decision-maker.
