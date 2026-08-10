# Phase 8.5 — Database Production Review

## RLS coverage — independently re-verified

Cross-referenced every `create table` statement (76 tables, across all 106 migrations) against every `enable row level security` statement — both the 47 direct `alter table ... enable row level security` statements and the 29-table `do $$ ... unnest(array[...])` dynamic loop in migration `0017_enable_rls.sql`. **Zero tables found without RLS.** This independently confirms the Step 1 audit's finding using a fresh extraction, not a re-quote of the same claim.

## Indexes — one genuine gap found and fixed

`challenge-browse`'s discovery query (`_challenge/workflow.ts`'s `browseChallenges`, the platform's main public discovery endpoint) always filters `status IN ('published','waiting') AND visibility = 'public'`, then sorts by `created_at desc` (the default, and the fallback for "newest"/"trending"/"recommended") or `stake_cents desc` ("highest_prize"). The only pre-existing index touching this table's query-relevant columns, `idx_challenges_status_game_id (status, game_id)`, doesn't cover `visibility` at all and covers neither sort column — every browse call has been filtering/sorting without index support for its most common shape.

Fixed in migration `0106_challenge_browse_indexes.sql` (additive, no existing index touched):
```sql
create index idx_challenges_visibility_status_created_at
  on challenges (visibility, status, created_at desc);
create index idx_challenges_visibility_status_stake_cents
  on challenges (visibility, status, stake_cents desc);
```

Every other table's index coverage was spot-checked against its actual query patterns during the Step 1 audit and Phase 7/8's own dedicated performance review (`docs/PHASE7_8_PERFORMANCE_REVIEW.md`) — no further gaps found in older (pre-Phase-7) tables.

## Foreign keys, constraints, triggers

Not re-audited from scratch this phase — these were established and reviewed across Phase 1-6's own deliverable docs (`docs/DB-001-deliverable.md` through `DB-003-deliverable.md`) and Phase 7/8's additive migrations followed the same conventions throughout (every new FK references an existing table, every new table's constraints were reviewed as part of each milestone's own implementation). No regression found during this phase's broader audit.

## Cron jobs

All `pg_cron` schedules (auth cleanup, storage cleanup, escrow/wallet reconciliation sweeps, AI engine sweeps, tournament scheduling sweep, season rollover — see `docs/PHASE7_8_MIGRATION_SUMMARY.md` for the Phase 7/8-specific ones) follow one consistent pattern (`pg_cron` + `pg_net.http_post` + Vault-stored secret) established since migration `0061`. No inconsistent or duplicate schedule found.

## Partitioning, VACUUM, ANALYZE

No table in this schema is currently large enough (by any evidence available in this environment — no live data volume to measure against) to warrant partitioning; the schema doesn't preclude it later (no primary keys or foreign keys were designed in a way that would block retrofitting partitioning onto, say, `wallet_ledger` or `domain_events` by date range if volume ever demands it). Postgres's autovacuum/autoanalyze defaults apply; no table has autovacuum explicitly tuned or disabled. **Recommendation, not actioned**: once real production volume exists, `wallet_ledger`, `domain_events`, and `audit_logs` (append-only, unbounded growth tables) are the first candidates to monitor for autovacuum tuning or date-range partitioning — this is a data-driven decision that can't be made responsibly without real volume to observe, so it's documented as a monitoring trigger in `PHASE8_5_OPERATIONS_MANUAL.md` rather than speculatively implemented.

## Deadlock risk

Re-verified (not just trusted from the audit): `postBalancedEntries()` (`_wallet/ledger.ts`) row-locks every wallet touched by a transaction in **stable sorted order** before mutating — the standard, correct deadlock-avoidance pattern for multi-row locking (if every transaction always acquires locks in the same global order, a circular wait, and therefore a deadlock, is impossible by construction). No other multi-row-locking code path was found in the codebase (`withTransaction` is used by `_team/service.ts`'s `transferOwnership`, but that only locks a single row).

## Migration ordering and rollback correctness

- Verified: every migration file `0001` through `0106` has a matching `.down.sql` rollback file — zero gaps.
- Verified: migration numbering has no gaps or duplicates.
- Known, previously-documented limitation (not new): enum-value-addition migrations (`alter type ... add value if not exists`) cannot be cleanly rolled back — Postgres has no `drop value` for enums. Every such migration's rollback file already documents this explicitly rather than pretending a rollback is possible.

## Data integrity, idempotency, financial consistency

Covered in depth by the dedicated `PHASE8_5_FINANCIAL_VERIFICATION.md` (Step 9) rather than duplicated here — summary: wallet ledger balance is structurally enforced (application-level rejection + a `DEFERRABLE` constraint trigger backstop + a column-privilege REVOKE making direct balance writes impossible), and every money-moving code path was re-verified to go through the shared `postBalancedEntries` primitive.

## Explicitly flagged, not fixed

- **`moderator_actions`** (migration `0009`) is a fully indexed, RLS'd, trigger-guarded table that no application code writes to — `_moderator/decisions.ts` records moderator decisions exclusively via `recordAudit` into `audit_logs` instead. This is dead-but-maintained schema. **Not fixed this phase**: closing this gap means a real product decision (wire moderation writes into a second table alongside `audit_logs`, or remove the table entirely) — either direction changes actual application behavior/data model, which is new functional work this phase's "zero feature development" mandate excludes. Flagged for a future phase to resolve deliberately, not silently carried forward.
