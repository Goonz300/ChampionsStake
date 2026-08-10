# Phase 8.5 — Database Guide

For the point-in-time production review, see `docs/PHASE8_5_DATABASE_REVIEW.md`. This document is the ongoing schema/migration reference.

## Migration conventions (established since Phase 1, unbroken through 107 migrations)

- **Additive only.** No historical migration file is ever edited. A schema change is always a new file with the next sequential number.
- **Every migration gets a paired rollback** in `supabase/rollback/<name>.down.sql` — verified this phase to have zero gaps across all 107 migrations.
- **Enum value additions are irreversible** — Postgres has no `DROP VALUE`. Every such migration's rollback file documents this explicitly rather than pretending a rollback is possible.
- **RLS is enabled on every table**, verified independently this phase (76 tables, zero gaps) — either via a direct `alter table ... enable row level security` or the bulk `do $$ ... unnest(array[...])` loop in migration `0017`. New tables should follow the direct-statement pattern (the bulk loop was a one-time migration for tables that predated it).
- **New indexes are added only for a demonstrated query pattern**, never speculatively — every index across this whole project traces to an actual `.eq()`/`.order()`/`.gte()` shape found in the corresponding service code.

## The wallet ledger's enforcement layers (the schema's most important invariant)

Three independent layers, verified directly against the trigger SQL this phase (`docs/PHASE8_5_FINANCIAL_VERIFICATION.md`):
1. Application-level: `postBalancedEntries` rejects unbalanced requests before opening a transaction.
2. Database constraint: `fn_validate_ledger_balance()`, a `DEFERRABLE INITIALLY DEFERRED` trigger, re-validates at COMMIT regardless of which code path produced the rows.
3. Column-write guard: `fn_guard_wallet_balance_columns()` + a column-level `REVOKE` make direct writes to `wallets.available_cents`/`escrowed_cents` structurally impossible outside the sync trigger.

Any future schema change touching `wallet_ledger`/`wallet_transactions`/`wallets` must preserve all three layers — this is the single most load-bearing part of the schema.

## Known, accepted schema debt (documented, not fixed this phase)

- **`moderator_actions`** (migration `0009`) — fully indexed, RLS'd, trigger-guarded, but nothing writes to it (`_moderator/decisions.ts` uses `audit_logs` instead). Closing this requires a real product decision (wire it up, or remove it) — deliberately not decided unilaterally this phase.
- **Tournaments have no `season_id`/`league_id` linkage** — the Tournament Platform and League/Season Platform are architecturally independent by design (see `docs/RANKING_PLATFORM_DESIGN.md`), which is why season-scoped player ratings remain permanently unpopulated (no reliable mapping from a challenge to a season exists in the schema).

## Partitioning / VACUUM (not yet needed, watch for the trigger)

No table is currently large enough (no live data volume exists to measure against) to warrant partitioning or non-default autovacuum tuning. First candidates once real volume exists: `wallet_ledger`, `domain_events`, `audit_logs` (all append-only, unbounded growth) — see `docs/PHASE8_5_DATABASE_REVIEW.md` for the specific monitoring trigger to watch for.

## Adding a new table checklist

1. New migration file, next sequential number, additive.
2. Paired `.down.sql` rollback.
3. `enable row level security` + real policies (not just `using (true)` unless genuinely public).
4. Indexes for the query patterns the corresponding service code will actually use — write the service code first if unsure, then index what it needs.
5. If it holds money or anything money-adjacent: route every write through the existing `postBalancedEntries`/wallet primitives — never a second insert path.
