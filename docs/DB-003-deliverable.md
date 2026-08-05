# ChampionsStake DB-003 — Phase 2 Gap-Fill (Notifications, Maintenance, Identity Lookups, Blocking, Temporary Suspensions)

## 1. Scope

Follow-up to the Phase 2 gap audit against DB-001/DB-002 and all later phases (0001–0064). Five approved gaps, implemented as purely additive migrations 0065–0070. Nothing existing was renamed, replaced, or removed.

## 2. What was added

**Notifications (0065):** `push_tokens` (FCM/APNs/Expo/Web Push, self-service RLS — a device registers its own token), `notification_templates` (reuses the existing `notification_category` enum from 0052 instead of a new taxonomy), `email_queue` (provider-abstracted via `email_provider` enum, defaulting to `resend` since that's the provider actually wired up per `apps/web`'s CI env — `queued`/`processing`/`sent`/`failed` status plus `retry_count`/`max_retries`/`next_retry_at`). None of these tables have a sender/worker yet — that is Edge Function work, out of this phase's DB-only scope; these are the durable state a future sender reads from and writes status back to.

**Maintenance windows (0066):** `maintenance_windows` — structured operational scheduling (type, planned/emergency, affected services, start/end, status, created_by/updated_by), explicitly distinct from the existing free-text `announcements` table (0055), which already has a `'maintenance'` category for the user-facing notice. RLS mirrors `announcements` exactly: scheduled/in-progress windows are publicly readable (pre-login banner), admin-only write.

**Identity lookups (0067–0068):** `countries`/`languages`/`timezones`, mirroring the existing `platforms`/`regions` lookup-table shape (0006) exactly. `profiles.country_code` is untouched (not renamed/retyped); a `NOT VALID` foreign key was added to it — Postgres's native mechanism for enforcing new/updated rows without retroactively validating existing data, which is the correct reading of "create foreign keys for future records." `profiles.language_code`/`profiles.timezone_name` are new, nullable columns. Countries/languages are seeded with a curated, production-safe subset (not the full ~249/~184 ISO lists — see 0068's header comment for how to load the complete sets later without any schema change). Timezones are seeded from Postgres's own `pg_timezone_names`, the authoritative source, not hand-typed.

**Blocked users (0069):** `blocked_users`, standalone and independent of `friends` — a user can block another user without any prior friend relationship. `friends.status = 'blocked'` (0008) is untouched. Wiring blocking into challenge/chat visibility RLS is explicitly left for a future phase; inventing that cross-table business logic now was outside what this phase asked for.

**Temporary suspensions (0070):** `user_suspensions` extends, rather than replaces, `profiles.status`/`suspended_at`/`suspended_reason_code` (0003). `profiles.status` remains the single source of truth for current account state, including its existing `trg_audit_profile_status_change` trigger (0025), which continues to fire unchanged. The new table adds structured, historical, expiry-aware suspension records. `fn_expire_temporary_suspensions()` is invoked directly by `pg_cron` every 5 minutes (not via the HTTP-callout-to-Edge-Function pattern used by other schedulers, e.g. 0045/0048/0054/0061/0064) — a disclosed, deliberate deviation, justified because this operation is self-contained SQL state with no external orchestration need, unlike e.g. `challenge-expire`, which must also release escrow.

## 3. RLS summary

All nine new tables have RLS enabled **and forced**. Posture:
- `push_tokens`: owner-scoped self-service (select/insert/update/delete where `user_id = auth.uid()`) + staff read.
- `notification_templates`, `email_queue`: backend-infrastructure-only (email_queue has zero authenticated/anon policies at all, same posture as `domain_events`/`idempotency_keys`, 0034 — it holds recipient email addresses and delivery error detail).
- `maintenance_windows`, `countries`/`languages`/`timezones`: public read, admin write (identical shape to `announcements`, 0055, and `platforms`/`regions`, 0006, respectively).
- `blocked_users`, `user_suspensions`: owner can read their own rows; staff (`is_admin()`/`is_moderator()`) can read all; no client write path — matches `moderator_actions`/`wallet_adjustment_requests` (writes go through a service-role Edge Function, never direct client table access).

## 4. Trigger & function summary

- `trg_push_tokens_updated_at`, `trg_notification_templates_updated_at`, `trg_email_queue_updated_at`, `trg_maintenance_windows_updated_at` — all reuse the existing `fn_set_updated_at()` (0011), no new function needed.
- `fn_expire_temporary_suspensions()` — new, `security definer`, called by a new `pg_cron` job `user-suspension-auto-expire-every-5-minutes`.

## 5. Index summary

`push_tokens(user_id) where is_active`, `notification_templates(category) where is_active`, `email_queue(status, created_at) where status in (queued, processing)`, `email_queue(next_retry_at) where status = failed`, `email_queue(user_id)`, `maintenance_windows(status, starts_at)`, `maintenance_windows(starts_at, ends_at) where status in (scheduled, in_progress)`, `blocked_users(blocker_id)`, `blocked_users(blocked_id)`, `user_suspensions(user_id, created_at desc)`, `user_suspensions(expires_at) where status = active`.

## 6. Known assumptions / deliberately not implemented

- No push/email **sender** Edge Function was built — these tables are the durable queue/registry a future sender consumes; sending itself is out of this phase's DB-only scope.
- Countries/languages seed data is curated, not the exhaustive ISO 3166-1/639-1 lists (deliberate, per this phase's explicit "avoid excessive output" instruction). Import path for the full sets is documented in 0068.
- Blocking is not yet wired into challenge/chat visibility RLS — only the block relationship itself exists.
- `countries.active` is a data-availability flag only, **not** a jurisdictional/legal eligibility determination for KYC or real-money wagering — that is a compliance decision outside this schema's authority and was not made here.
- No canonical "Business Rules" document exists in this repository (referenced throughout 0001–0064's comments, but not present as a file) — design decisions in this phase are grounded in existing schema precedent and this phase's own explicit instructions, not that external document.

## 7. Verification

- Static check: balanced parentheses and `$$` dollar-quoting on all six new migration files — verified programmatically, all balanced.
- `deno fmt --check` / `deno lint` / `deno check` (all 66 Edge Function entry points) — pass, unaffected by this phase (DB-only changes).
- `npm run format:check` / `npm run lint` / `npm run typecheck` / `npm run build` (apps/web) — pass.
- **Not verified in this environment**: no live Postgres/Supabase instance was reachable (no `psql`/`supabase` CLI in this sandbox). Please run `supabase db push` (or the `psql`-loop in this README) against a real Postgres 16 instance before merging — the same caveat DB-001/DB-002 disclosed for the original 0001–0026 migrations.

## Stop point

DB-003 (Phase 2 gap-fill) is complete.
