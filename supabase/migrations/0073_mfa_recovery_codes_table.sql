-- ============================================================================
-- Migration 0073: MFA Recovery Codes
--
-- Phase 3C (MFA & Advanced Account Security), per the approved Phase 3
-- Architecture Rev. 2, §5/§12, deferred there until MFA enforcement was
-- actually being built -- it is now. Purely additive -- no existing
-- migration, table, enum, function, or RLS policy touched.
--
-- Supabase's own MFA API (auth.mfa.*) has no backup/recovery-code concept
-- -- verified against the pinned SDK, not assumed -- so this is
-- application-owned. Hash-only storage: the plaintext code is generated
-- and returned to the client exactly once, at generation time, and is
-- never persisted or logged anywhere. One-time use, enforced by an atomic
-- UPDATE ... WHERE used_at IS NULL ... RETURNING at consumption time
-- (_shared application code, not this migration) rather than a
-- check-then-act pattern, which would be a genuine race condition.
-- ============================================================================

create table mfa_recovery_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  code_hash text not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  constraint uq_mfa_recovery_codes_user_hash unique (user_id, code_hash)
);
comment on table mfa_recovery_codes is
  'One-time MFA recovery codes, hash-only (SHA-256) storage -- the plaintext is shown to the user exactly once at generation and never persisted. Consumption must use an atomic UPDATE ... WHERE used_at IS NULL ... RETURNING to prevent the same leaked code being used twice concurrently.';

-- Supports both "find my unused codes" (regeneration, status display) and
-- the atomic consumption query's WHERE clause.
create index idx_mfa_recovery_codes_user_unused on mfa_recovery_codes (user_id) where used_at is null;

alter table mfa_recovery_codes enable row level security;
alter table mfa_recovery_codes force row level security;

-- Matches wallet_adjustment_requests/moderator_actions convention: owner
-- can see their own rows (to show "N codes remaining" without exposing the
-- hash itself is a query-shape concern, not an RLS concern -- callers
-- select only non-hash columns), staff can see all for support/investigation.
-- No client INSERT/UPDATE/DELETE at all -- generation, consumption, and
-- regeneration all go through a service-role Edge Function/Route Handler,
-- matching the existing no-client-write posture on every comparable table
-- in this schema (devices, user_sessions, moderator_actions).
create policy mfa_recovery_codes_select_own on mfa_recovery_codes for select using (user_id = auth.uid());
create policy mfa_recovery_codes_select_staff on mfa_recovery_codes for select using (is_admin() or is_moderator());
