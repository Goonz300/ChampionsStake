# Phase 8.5 — Scaling Guide

Honest baseline: nothing in this codebase has ever run against real traffic. This document states what's designed to scale, what has a known ceiling controlled by a third party, and what to actually watch — not invented capacity numbers.

## What scales without this codebase doing anything special

- **Edge Functions**: stateless, serverless, scale horizontally by Supabase's own platform automatically. No connection-pool-per-instance concern at the application layer — see the Postgres connection note below for the one place this isn't quite true.
- **Frontend (Vercel)**: serverless/edge rendering, scales automatically per Vercel's platform.

## What has a real, plan-tier-controlled ceiling

- **Postgres connections**: `_shared/transactions/index.ts` deliberately uses a tiny connection pool (`config.database.maxPoolSize`, default 1) against Supavisor's transaction pooler specifically *because* many concurrent serverless Edge Function invocations each opening unbounded connections is a well-known way to exhaust a pooler. This is already the correct defensive default — the actual ceiling is Supavisor's own pool size, a Supabase project-tier setting to check before assuming headroom.
- **Realtime connections**: Supabase Realtime's concurrent-connection ceiling is a function of the project's plan tier, not application code (see `docs/PHASE8_5_REPOSITORY_AUDIT.md`'s Realtime finding). `load-tests/k6-realtime-websockets.js` (Step 7) is built specifically to find this ceiling for real on a target plan tier — run it before any launch that expects large concurrent spectator counts.
- **Rate limiting backend**: Redis (Upstash) if configured, else a Postgres fallback. The fallback is correct and tested but not recommended for sustained high-frequency production traffic (its own warning log says so) — provision Upstash for production, don't rely on the fallback path as the steady-state backend.

## Levers that exist and are already correctly implemented

- **Wallet write concurrency**: `postBalancedEntries` row-locks wallets in stable sorted order — this is a deliberate serialization point for concurrent writes to the *same* wallet (correct, prevents a lost-update race), but does not serialize writes across *different* wallets, so overall ledger throughput scales with distinct-wallet concurrency, not total transaction count.
- **Reconciliation sweep**: parallelized this phase (5 account-type checks per wallet now run concurrently via `Promise.all`) — see `docs/PHASE8_5_PERFORMANCE_REVIEW.md` finding #5. Still processes wallets page-by-page (500/page) sequentially; if the nightly sweep ever approaches its scheduling window under real wallet-count growth, the next lever is running multiple pages concurrently, not yet built.
- **Notification fan-out**: this phase's fix (template rendered once per event, not once per recipient — see the same performance review) removes the dominant per-recipient cost; remaining per-recipient work (preference check, insert, push/email dispatch) still scales linearly with recipient count per event, which is appropriate (each recipient genuinely needs their own row).

## What would need new work to scale further (not built, explicitly out of scope this phase)

- **Read caching**: confirmed zero caching layer exists anywhere (Step 6 finding) — deliberately not built, since almost every page in this app is personalized/financial and caching shared data across users would be actively dangerous, not a missed optimization. If a genuinely cacheable, non-personalized read path emerges (e.g. a public leaderboard), it would need a deliberate, scoped caching decision at that time, not a blanket policy.
- **Database read replicas**: not configured; would help read-heavy paths (analytics, leaderboards) if Postgres write load ever becomes the bottleneck rather than connection count — a Supabase project-tier feature to enable if/when that's the actual observed constraint, not a default to build for speculatively.
- **Multi-region**: not considered; this is a single-region deployment by construction (one Supabase project, one Vercel deployment). Appropriate for current scale; revisit only if latency-to-region data actually demands it.

## Concrete next step

Run `load-tests/` (Step 7) against a real staging environment, record actual p95/p99 numbers and the real Realtime connection ceiling, and replace this document's qualitative statements with those measurements. See `docs/PHASE8_5_LOAD_TESTING.md`.
