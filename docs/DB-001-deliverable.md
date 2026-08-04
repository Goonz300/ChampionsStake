# ChampionsStake DB-001 — Database Foundation

## 1. Database Overview

29 tables (26 requested + 3 justified additions — see §9), 25 enum types, 13 functions, 34 triggers, 7 views, idempotent seed data. Every table has a UUID primary key, `created_at`, and (where mutable) `updated_at`. Money movement is modeled as a genuine double-entry ledger: `wallet_ledger` is the immutable source of truth, and `wallets.available_cents`/`escrowed_cents` are a trigger-maintained cache that application code cannot write directly — only `wallet_ledger` inserts can move a balance. This directly satisfies the phase's Financial Requirements section and closes Readiness Report Critical #3 (non-negative/reconciliation constraints) and contributes toward Critical #5 (concurrency — see `result_locked` and the state-machine trigger).

**Justified additions beyond the requested 26 tables:**
- `system_settings` — required by Step 8's "populate ... System Settings" seed-data instruction, which has no other home.
- `platforms`, `regions` — the brief's Step 1 listed these as enum examples, but Step 8 asks to "populate Platforms" and "Regions" as seed data. Seedable rows, not a fixed enum, is what makes that instruction coherent (adding a new platform shouldn't require an enum-altering migration), so they're lookup tables instead.

## 2. ERD Description

**Identity cluster:** `profiles` (1:1 with `auth.users`) → `devices` (1:many), `user_sessions` (1:many).

**Financial cluster:** `wallets` (1:1 with `profiles`) → `wallet_transactions` (1:many) → `wallet_ledger` (1:many per transaction, balanced debit/credit legs). `escrow_accounts` (1:1 with either a `challenge` or a `tournament`) → `escrow_transactions` (1:many, each tied to one `wallet_transaction`).

**Competition cluster:** `games` → `challenges` (1:many) → `challenge_participants` (1:2, creator+opponent), `challenge_events` (1:many, audit trail), `challenge_messages` (1:many, chat), `challenge_attachments` (1:many, media). `tournaments` → `tournament_registrations` (1:many), `tournament_rounds` (1:many) → `tournament_matches` (1:many, each pointing to one `challenge` — tournament matches reuse the same state machine as 1v1 challenges).

**Trust & safety cluster:** `challenges` → `disputes` (1:1) → `dispute_evidence` (1:many), `moderator_actions` (1:many, generic — also references challenges/disputes for other action types). `reports` references `profiles`/`challenges`/`challenge_messages` independently.

**Platform cluster:** `notifications`, `friends` (self-referencing on `profiles`), `audit_logs` (system-wide, references nothing by FK — `target_table`/`target_id` are loosely typed by design so it can log against any table), `feature_flags` (standalone).

**Lookup cluster:** `platforms`, `regions`, `system_settings` — referenced by code, not UUID FK, where used as a classification (`challenges.platform_code`/`region_code`).

## 3. Migration Folder Structure

```
supabase/
  migrations/
    0001_extensions.sql
    0002_enums.sql
    0003_core_identity_tables.sql
    0004_wallet_ledger_tables.sql
    0005_escrow_tables.sql
    0006_games_challenges_tables.sql
    0007_tournament_tables.sql
    0008_social_notification_tables.sql
    0009_dispute_moderation_tables.sql
    0010_audit_feature_flag_tables.sql
    0011_functions.sql
    0012_triggers.sql
    0013_views.sql
    0014_seed_data.sql
    README.md                 (execution order, apply/rollback commands)
  rollback/
    0001_extensions.down.sql  ... 0014_seed_data.down.sql  (one per migration, reverse order)
  functions/                  (empty — Edge Functions land in Roadmap Phase 5, not this task)
```

## 4–7. Migration Files, Triggers, Functions, Views

All in the files above. Summary of the most structurally important pieces:

- **Double-entry invariant**: `fn_validate_ledger_balance()`, a `DEFERRABLE INITIALLY DEFERRED` constraint trigger on `wallet_ledger`, rejects any transaction whose ledger legs don't sum to zero (debits = credits) across all accounts touched — including cross-wallet transfers (e.g. escrow release moving money from a loser's wallet to a winner's wallet plus a platform fee account, all in one balanced transaction).
- **Balance cache integrity**: `fn_sync_wallet_cached_balance()` is the *only* path that can write `wallets.available_cents`/`escrowed_cents`; `fn_guard_wallet_balance_columns()` blocks every other write attempt, including from a superuser-equivalent application role, using a session-scoped flag the sync trigger sets internally.
- **Immutability**: `fn_prevent_mutation()` is attached to `wallet_ledger`, `escrow_transactions`, `challenge_events`, `dispute_evidence`, `moderator_actions`, and `audit_logs` — none of these can ever be updated or deleted, full stop. `wallet_transactions` gets a softer version (`fn_prevent_completed_transaction_mutation()`) that allows updates only while `status = 'pending'`.
- **State machines**: `fn_challenge_state_guard()` and `fn_tournament_state_guard()` whitelist valid status-transition edges per Business Rules §3/§5, rejecting any other transition at the database layer — a second line of defense beneath the Edge Function logic that will enforce timing rules in Roadmap Phase 4.
- **Views**: `v_wallet_summary` and `v_escrow_summary` exist specifically to support the nightly reconciliation job the Readiness Report calls for — they surface the ledger-derived balance next to the cached one so divergence is immediately visible.

## 8. Seed Data

8 games, 6 platforms, 7 regions, 5 feature flags (all default `false` — nothing goes live until explicitly enabled per the Roadmap's safe build order), 18 system settings sourced directly from specific Business Rules sections (cited inline in the SQL comments).

## 9. Verification Checklist

- [x] Every table has `id uuid primary key default gen_random_uuid()`
- [x] Every mutable table has `created_at` + `updated_at`, with an `updated_at` trigger
- [x] Every immutable table (`wallet_ledger`, `escrow_transactions`, `challenge_events`, `dispute_evidence`, `moderator_actions`, `audit_logs`) has an UPDATE/DELETE-blocking trigger
- [x] Double-entry balance invariant enforced by a deferred constraint trigger, verified programmatically (all 26 declared enums referenced, all FK targets exist before use — see verification commands below)
- [x] All 25 enum types declared, all referenced, none orphaned
- [x] All 29 tables created in dependency-safe order (verified by parsing every `references` clause against tables created so far)
- [x] All SQL files have balanced parentheses and balanced `$$` dollar-quoting (verified programmatically)
- [x] Rollback script exists for every migration, in reverse-dependency order
- [ ] **Not verified in this environment**: no live PostgreSQL instance was reachable (this container has no network access, so `apt-get install postgresql` and Supabase CLI both failed to fetch). The checks above are static/structural, not a live `psql` execution. Please run the commands below against a real Supabase/Postgres instance before merging.

**Commands to actually execute this checklist live** (run these yourself — I can't from here):
```bash
supabase start                     # or connect to a real project
supabase db push                   # applies 0001-0014 in order
psql "$DATABASE_URL" -c "select * from v_wallet_summary limit 1;"
psql "$DATABASE_URL" -c "select * from v_escrow_summary limit 1;"
psql "$DATABASE_URL" -c "insert into wallet_ledger (wallet_transaction_id, wallet_id, account_type, direction, amount_cents) values (gen_random_uuid(), gen_random_uuid(), 'available', 'credit', 100);"
  # ^ this INSERT should FAIL two ways: FK violation on wallet_transaction_id/wallet_id,
  #   and (if those were real) the deferred balance trigger would reject an unbalanced entry at commit.
```

## 10. Rollback Strategy

See `supabase/migrations/README.md` for the full explanation. Summary: one `.down.sql` file per migration in `supabase/rollback/`, applied in reverse numeric order. Rollback of the wallet/escrow migrations (0004/0005) is explicitly flagged as development-only — production recovery must use Supabase PITR, not a table drop, per the Business Rules "no financial record may be modified after completion" principle.

## Stop point

DB-001 is complete. Per your instruction, stopping here and awaiting approval before DB-002.
