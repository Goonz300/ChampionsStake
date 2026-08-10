# Phase 8.5 — Performance Guide

For point-in-time findings, see `docs/PHASE7_8_PERFORMANCE_REVIEW.md` and `docs/PHASE8_5_PERFORMANCE_REVIEW.md`. This document is the ongoing reference for how this codebase thinks about performance, so future changes stay consistent with the fixes already made.

## Conventions established by the fixes already made

- **Every query needs either a bound or a reason it can't grow unbounded.** Tables that only accumulate (`wallet_ledger`, `fraud_flags`, `domain_events`, `audit_logs`, `disputes`) get an explicit `.limit()` on any read that reduces rows to a sum/count in application code — see `_ai/analytics-engine.ts`'s `ANALYTICS_SCAN_LIMIT` pattern for the template to follow.
- **Independent queries run concurrently (`Promise.all`), not sequentially**, when neither depends on the other's result — see `_wallet/reconciliation.ts`'s 5-per-wallet balance checks or the frontend page waterfall fixes for the pattern.
- **Compute once per logical unit of work, not once per fan-out iteration.** The notification-template rendering fix (render once per event, use for every recipient, not once per recipient) is the canonical example — before adding a loop that repeats an expensive lookup per iteration, check whether the lookup's inputs actually vary per iteration or are constant across the whole loop.
- **Every outbound third-party call needs a timeout** (`AbortSignal.timeout(...)`) — see `docs/PHASE8_5_CHAOS_ENGINEERING.md`. A missing timeout is both a resilience gap and a performance gap (a hang ties up an invocation's full execution budget for no benefit).
- **New indexes are additive migrations, added when a real query pattern is found unindexed** — never speculative. Every index added across Phase 7/8/8.5 was traced to an actual query shape in the code, not "this might help."

## Where to look when investigating a slow path

1. Is the query bounded? (`.limit()`, date-range filter)
2. Is it indexed for its actual filter/sort columns, not just *a* column on the table?
3. Is it inside a loop that could batch into one `.in()` query instead?
4. Is it awaited sequentially next to an independent query that could run concurrently?
5. Is it a third-party call with no timeout?

These five questions caught every genuine finding in both performance reviews — they're a reasonable first pass before profiling.

## Deliberately not optimized (see `docs/PHASE8_5_PERFORMANCE_REVIEW.md` for the reasoning)

- No caching layer anywhere — correct for a personalized/financial app, not a gap.
- `_realtime/chat.ts`'s `markSeen` N+1 — real, but the correct fix is a behavioral change to read-receipt semantics, deferred pending more careful verification than a mechanical query-shape fix.
- The 4 sequential auth-server round trips per request — Supabase's own documented safe re-verification pattern; removing it would be a security regression.

## Wallet write concurrency: expected, not a bug

`postBalancedEntries` row-locks every wallet a transaction touches, in stable sorted order. Under heavy concurrent write pressure to the *same* wallet, this is a deliberate serialization point — latency there is by design (correctness over raw throughput for money movement), not something to "fix" by removing the lock. Watch for it becoming *disproportionate* (see `docs/PHASE8_5_MONITORING_GUIDE.md`), not for its mere existence.
