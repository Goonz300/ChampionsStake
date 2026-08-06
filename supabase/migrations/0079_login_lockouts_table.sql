-- ============================================================================
-- Migration 0079: Login Lockouts (Layer 8 -- Account Lockout)
--
-- Phase 5 (Enterprise Rate Limiting & Attack Mitigation). Purely additive --
-- no existing migration, table, enum, function, or RLS policy touched.
--
-- Verified against the actual repository before writing this (this
-- session's own audit-first rule): no locked_until/lockout/account_locked
-- column or table existed anywhere prior to this migration -- login/MFA
-- brute-force protection was previously a rolling rate-limit WINDOW only
-- (lib/auth/rate-limit.ts, audit_logs-backed), with no persisted "this
-- identity is currently locked" state and no escalating lockout duration.
--
-- Keyed by (email, ip_address) -- the SAME identity pair
-- isLoginRateLimited/recordFailedLogin already use -- deliberately NOT by
-- user_id. Resolving an arbitrary login email to a real user_id before
-- authentication would be a new account-enumeration side channel; this
-- codebase already avoids that (see forgot-password/route.ts's comment on
-- never revealing whether an email exists). Locking by the same
-- already-used identity pair extends the existing keying strategy instead
-- of introducing a second, riskier one.
-- ============================================================================

create table login_lockouts (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  ip_address text not null,
  locked_until timestamptz not null,
  lock_count int not null default 1,
  locked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_login_lockouts_email_ip unique (email, ip_address)
);
comment on table login_lockouts is
  'Layer 8 account lockout state, keyed by (email, ip_address) to match the existing login rate-limit identity (lib/auth/rate-limit.ts) without introducing an email-to-user_id enumeration channel. lock_count escalates the lockout duration on repeated offenses (application logic, not this migration); "automatic unlock" is simply locked_until elapsing -- checked at read time, no sweep job needed. Administrator unlock (Layer 16) deletes matching rows for an email across all IPs.';

create index idx_login_lockouts_locked_until on login_lockouts (locked_until);

alter table login_lockouts enable row level security;
alter table login_lockouts force row level security;

-- No client SELECT/INSERT/UPDATE/DELETE at all -- checked and written only
-- from the login route's service-role client (lib/auth/lockout.ts), same
-- no-client-write posture as devices/user_sessions/mfa_recovery_codes.
-- Staff can read for the admin "view locked accounts" surface (Layer 16).
create policy login_lockouts_select_staff on login_lockouts for select using (is_admin() or is_moderator());
