# Phase 8.5 — Disaster Recovery Guide

## Backups: Supabase-managed, verify the setting, don't build a parallel system

Postgres backups and Point-in-Time Recovery (PITR) are a Supabase project-tier feature, not something this codebase implements — and shouldn't: a hand-rolled backup system for a database Supabase already backs up would be redundant infrastructure risk, not resilience. **Before launch, confirm directly in the Supabase dashboard**: automated daily backups are enabled, and PITR is enabled if the plan tier supports it (recommended for a real-money platform — PITR lets you restore to any point within the retention window, not just the last daily snapshot).

## What actually needs a documented recovery procedure

Backups alone don't answer "what do I do when I've restored." This codebase's specific recovery concerns:

### 1. Migration state after a restore

A PITR restore rolls the schema back to whatever migration state existed at that timestamp too — if migrations were applied *after* the restore point, they need to be **reapplied in order** post-restore (`supabase db push`, same as a fresh deploy). Check `supabase migration list` immediately after any restore to see what's missing before assuming the restored database matches the current codebase's expectations.

### 2. Ledger integrity after a restore

**This is the most important post-restore check.** A restore to a point mid-transaction-processing could theoretically leave `wallet_ledger` in a state the `fn_validate_ledger_balance` deferred constraint trigger would have caught in real-time but a restore bypasses (the trigger only fires on write, not on data that arrives via a restore). Run every query in `docs/PHASE8_5_FINANCIAL_VERIFICATION.md` immediately after any restore, before allowing the application back online. A restore that reintroduces an unbalanced ledger entry or negative balance must be treated as a financial incident, not a routine recovery step.

### 3. Idempotency key window

`idempotency_keys` rows expire (`config.timeouts.idempotencyWindowHours`). A restore to a point where a key had already expired, followed by a client retry using that same key, would be treated as fresh — this is the SAME behavior as a normal expiry, not a new restore-specific risk, but worth knowing if you're investigating a duplicate-seeming transaction shortly after a restore.

### 4. Realtime/Storage state

Realtime has no persistent state to restore (it's a live pub/sub layer over the current database state — once Postgres is restored, Realtime reflects it automatically on next connection). Storage (file uploads) is a separate system from Postgres — confirm whether the Supabase plan's backup covers Storage buckets independently; if not, uploaded files (avatars, dispute evidence, KYC documents) are not covered by a database-only restore and need their own retention/backup conversation before launch.

## Recovery drill (recommended before launch, not yet performed — no live environment exists in this development session)

1. On a disposable staging project: seed realistic data, note a timestamp, make further changes, then perform a PITR restore to the noted timestamp.
2. Reapply any migrations that postdate the restore point.
3. Run the financial verification queries — confirm clean.
4. Confirm the application (frontend + Edge Functions) functions normally against the restored database with no code changes needed.
5. Record actual restore time (how long did it take) — this becomes the real RTO (Recovery Time Objective) number for `PHASE8_5_PRODUCTION_CHECKLIST.md`, replacing a guess with a measurement.

## RPO/RTO — stated honestly

**Recovery Point Objective (RPO)**: bounded by PITR granularity if enabled (typically continuous/near-zero data loss on Supabase's PITR), or by backup frequency if not (up to 24h of data loss on daily-only backups). **This is a plan-tier decision to make explicitly before launch**, not a default to assume.

**Recovery Time Objective (RTO)**: not yet measured (see drill above) — do not publish an RTO commitment to users/stakeholders until the drill has actually been run once.
