# ChampionsStake Database Migrations

## Execution order

Run in strict numeric order — every file depends on the ones before it:

| # | File | Creates |
|---|---|---|
| 0001 | `extensions.sql` | `pgcrypto`, `pg_trgm` |
| 0002 | `enums.sql` | All 25 enumerated types |
| 0003 | `core_identity_tables.sql` | `profiles`, `devices`, `user_sessions`, `system_settings` |
| 0004 | `wallet_ledger_tables.sql` | `wallets`, `wallet_transactions`, `wallet_ledger` |
| 0005 | `escrow_tables.sql` | `escrow_accounts`, `escrow_transactions` |
| 0006 | `games_challenges_tables.sql` | `platforms`, `regions`, `games`, `challenges`, `challenge_participants`, `challenge_events`, `challenge_messages`, `challenge_attachments` |
| 0007 | `tournament_tables.sql` | `tournaments`, `tournament_registrations`, `tournament_rounds`, `tournament_matches` |
| 0008 | `social_notification_tables.sql` | `notifications`, `friends`, `reports` |
| 0009 | `dispute_moderation_tables.sql` | `disputes`, `dispute_evidence`, `moderator_actions` |
| 0010 | `audit_feature_flag_tables.sql` | `audit_logs`, `feature_flags` |
| 0011 | `functions.sql` | All PL/pgSQL functions |
| 0012 | `triggers.sql` | All triggers (wires 0011's functions onto 0003–0010's tables) |
| 0013 | `views.sql` | All 7 reporting/reconciliation views |
| 0014 | `seed_data.sql` | Games, platforms, regions, feature flags, system settings (idempotent — safe to re-run) |

**Naming note:** files are numbered `0001`–`0014` for readability in this deliverable. If you're using the Supabase CLI day-to-day, run `supabase migration new <name>` for each file instead so they get the CLI's expected `<timestamp>_<name>.sql` format — the SQL content is unchanged either way, only the filename convention differs.

## Applying migrations

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

Or, against a local/dev Postgres directly:
```bash
for f in supabase/migrations/*.sql; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
done
```

## Rollback strategy

Every migration has a companion file in `supabase/rollback/` (e.g. `0004_wallet_ledger_tables.down.sql`) that reverses it. Rollbacks must be run in **reverse numeric order** (0014 down to 0001) since later migrations add foreign keys onto earlier tables.

```bash
for f in $(ls -r supabase/rollback/*.down.sql); do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
done
```

**Important:** the rollback for 0004 (wallets/ledger) and 0005 (escrow) will destroy financial history. These down-scripts are provided for clean-slate development environments only — per the Business Rules "no financial record may be modified after completion" principle, no rollback script for these tables should ever be run against a database that has processed a real transaction. Supabase's own Point-in-Time Recovery (PITR), not a `DROP TABLE`, is the correct recovery mechanism in production (see Readiness Report Critical #6 — PITR/backup configuration is Roadmap task SEC/OBS work, still outstanding as of this phase).

## Idempotency

- 0001–0013 are **not** safe to re-run (they use bare `create type`/`create table`, which will error on a second run) — this is intentional, since Supabase's migration runner tracks which migrations have already been applied and never re-runs one. Do not add `if not exists` to these; a silent no-op on a schema migration hides drift.
- 0014 (seed data) **is** safe to re-run — every insert uses `on conflict ... do nothing`.

## Phase 2 additions (0065–0070)

Gap-fill migrations from the Phase 2 database-layer audit. Purely additive — no existing table, enum, function, trigger, index, or RLS policy from 0001–0064 was modified, renamed, or removed.

| # | File | Creates |
|---|---|---|
| 0065 | `notification_infrastructure.sql` | `push_tokens`, `notification_templates`, `email_queue` (+ `push_provider`, `email_provider`, `email_queue_status` enums) |
| 0066 | `maintenance_windows.sql` | `maintenance_windows` (+ `maintenance_schedule_type`, `maintenance_window_status` enums) |
| 0067 | `identity_lookup_tables.sql` | `countries`, `languages`, `timezones`; adds `profiles.language_code`/`profiles.timezone_name` (new, nullable) and a `NOT VALID` FK on the existing `profiles.country_code` |
| 0068 | `identity_lookup_seed_data.sql` | Curated country/language seed rows + full timezone list from `pg_timezone_names` |
| 0069 | `blocked_users_table.sql` | `blocked_users` (standalone, independent of `friends`) |
| 0070 | `temporary_suspensions.sql` | `user_suspensions` (+ `user_suspension_status` enum), `fn_expire_temporary_suspensions()`, a `pg_cron` job for automatic expiry |

Not safe to re-run except 0068 (seed data, `on conflict do nothing` throughout), matching the same convention as 0001–0014.

**0067's `NOT VALID` foreign key**: `fk_profiles_country_code` is enforced on every new/updated row immediately but does not retroactively validate pre-existing `profiles.country_code` values. Run `alter table profiles validate constraint fk_profiles_country_code;` once existing production data is confirmed to consist entirely of seeded `countries.code` values (see 0068 for how to load the full ISO 3166-1 list beyond the curated seed).

## Phase 3A addition (0071)

Authentication implementation, per the approved Phase 3 Architecture Rev. 2. Purely additive.

| # | File | Creates |
|---|---|---|
| 0071 | `jwt_revocation_timestamp_column.sql` | `profiles.sessions_invalidated_at` (nullable, additive) — closes the stateless-access-token revocation window for `/api/auth/logout-all`; see the migration's own header comment and `_shared/auth/session.ts`'s `assertSessionNotInvalidated`. |

Not safe to re-run (bare `alter table add column`, same convention as 0001–0013/0065–0070's non-seed files).

## Phase 3B addition (0072)

Session & device management, per the approved Phase 3 Architecture Rev. 2, §8/§12. Purely additive.

| # | File | Creates |
|---|---|---|
| 0072 | `session_device_context_columns.sql` | `devices.user_agent` (nullable) — the existing `device_fingerprint` is a one-way hash and can't produce a human-readable label on its own; `user_sessions.device_id` (nullable FK to `devices.id`, `on delete set null`) — links a session to the device that created it, previously written independently with no relationship between them. |

**Note:** the architecture document's §8 also lists `user_sessions.ip_address`/`user_agent` as missing — verified against the actual schema before writing this migration, both already existed since 0003 and are already written by `recordSession`. Not re-added here; the architecture document has a stale claim on this point.

Not safe to re-run (bare `alter table add column`, same convention as the rest of this file).

## Phase 3C addition (0073)

MFA & recovery codes, per the approved Phase 3 Architecture Rev. 2, §5/§12 — deferred there until MFA enforcement was actually being built. Purely additive.

| # | File | Creates |
|---|---|---|
| 0073 | `mfa_recovery_codes_table.sql` | `mfa_recovery_codes` (`id, user_id, code_hash, used_at, created_at`) — hash-only, one-time-use MFA backup codes. RLS owner-select/staff-select only, no client write (matches `devices`/`user_sessions`/`moderator_actions` convention). |

Not safe to re-run (bare `create table`, same convention as 0001–0013/0065–0072's non-seed files).

## Phase 3C addition (0074)

Independent-review finding, not part of the original milestone list: without this column, middleware had no way to tell "a session that finished login via a recovery code" apart from "a session that never completed MFA at all" — both look identical to GoTrue's own aal2 signal, since GoTrue has no concept of recovery codes. Purely additive.

| # | File | Creates |
|---|---|---|
| 0074 | `session_mfa_verified_column.sql` | `user_sessions.mfa_verified_at` (nullable `timestamptz`) — set only when a session completed login via a recovery code; read by middleware as a fallback MFA-satisfied signal alongside aal2. |

Not safe to re-run (bare `alter table add column`, same convention as the rest of this file).
