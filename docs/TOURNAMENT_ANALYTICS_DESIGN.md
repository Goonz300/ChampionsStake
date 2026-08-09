# Tournament Analytics Design (Phase 8 M8)

## 1. Scope boundary vs. Phase 7 M6

`_tournament/analytics.ts` covers tournament-*specific* metrics: participation, revenue, drop-off, prize efficiency, completion rate, organizer quality, ecosystem health/growth. `_ai/analytics-engine.ts` (Phase 7 M6) covers platform-*wide* metrics: revenue forecasting, fraud forecasting, player LTV/churn. The two never duplicate a computation — `getTournamentEcosystemHealth` (this module) is distinct from `platformHealth` (Phase 7 M6), which itself internally calls both forecasts, not this module's functions.

## 2. Heuristics (`_tournament/analytics-heuristics.ts`, pure, unit-tested)

- `computeDropOffFunnel` — retention at each stage of the registration → check-in → play funnel; guards against divide-by-zero on an empty first stage.
- `computePrizeEfficiency` — actual distributed / pool, clamped to never exceed 1.0 even under a rounding artifact that distributes fractionally more than the pool.

## 3. Per-tournament views

`getTournamentParticipation`, `getTournamentRevenue`, `getTournamentDropOff`, `getTournamentQuality` — each organizer(-of-that-tournament)-or-admin only (`requireTournamentOwnerOrAdmin` in `tournament-organize/index.ts`), since revenue in particular is not public data the way `tournament-browse`'s bracket/standings views are.

## 4. Ecosystem-level views

`getTournamentEcosystemHealth(days)` — completion rate, cancellation rate, average participation across all tournaments created in the window. `getSchedulingAdherence` (delegates to `_tournament/scheduling.ts`, see `SCHEDULING_DESIGN.md`).

**Performance fix**: `getTournamentEcosystemHealth` originally issued one `tournament_registrations` count query *per tournament* in the window (an N+1 pattern — could be hundreds of round-trips for a busy 30-day window). Fixed: a single batched `.in("tournament_id", ids)` query replaces the per-tournament loop.

## 5. Edge Function surface

Exposed entirely through `tournament-organize`'s `?view=` GET surface (`participation`, `revenue`, `drop_off`, `quality`, `ecosystem_health`, `scheduling_adherence`) — no dedicated analytics Edge Function, matching the "consolidated view/action function" convention used throughout Phase 7/8.

## 6. Verification checklist

- [x] Zero duplicated aggregation logic between this module and `_ai/analytics-engine.ts` — confirmed by the Phase 7/8 cross-system integration audit (grep for shared table/computation overlap found none)
- [x] `computeDropOffFunnel`/`computePrizeEfficiency` unit-tested (7 pure-function test cases), including explicit divide-by-zero and over-100%-distribution edge cases
- [x] `getTournamentEcosystemHealth`'s N+1 query pattern fixed and re-validated (`deno test` clean post-fix)
- [ ] **Known, accepted gap**: team/league/season data is not represented in either analytics surface (`_ai/analytics-engine.ts` or this module) — flagged by the cross-system integration audit as a real absence, not a bug (nothing is broken; the signal simply isn't incorporated yet). Left out of this pass's scope since it's additive feature surface, not a defect, and the review's time budget prioritized fixing genuine defects over extending analytics coverage. Candidate for a future milestone.
- [ ] **Not verified in this environment**: no live Postgres for the actual aggregate query performance under real data volume.
