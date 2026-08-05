-- ============================================================================
-- Migration 0070: Temporary Suspensions
--
-- SCOPE NOTE (Phase 2 gap audit): profiles.status/suspended_at/
-- suspended_reason_code (0003) already record that a user IS suspended, but
-- have no expiry -- every existing suspension is effectively permanent
-- until a moderator manually reinstates the account. This migration
-- EXTENDS that mechanism rather than replacing it: profiles.status stays
-- the single source of truth for current account state (untouched here,
-- including its existing fn_audit_profile_status_change trigger from 0025,
-- which keeps firing exactly as before on every status change this
-- migration causes). This new table adds the structured, historical,
-- expiry-aware record of WHY/WHEN/BY WHOM/UNTIL WHEN a suspension was
-- issued, which no existing table holds.
-- ============================================================================

create type user_suspension_status as enum ('active', 'expired', 'lifted');

create table user_suspensions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  reason text not null,
  moderator_id uuid references profiles (id), -- null = system-issued
  starts_at timestamptz not null default now(),
  expires_at timestamptz, -- null = indefinite, matches existing permanent-suspension behavior
  lifted_at timestamptz,
  lifted_by uuid references profiles (id), -- null when auto-expired rather than manually lifted
  status user_suspension_status not null default 'active',
  created_at timestamptz not null default now(),
  constraint chk_user_suspensions_expiry_after_start check (expires_at is null or expires_at > starts_at)
);
comment on table user_suspensions is
  'Structured, historical suspension records with optional expiry, extending profiles.status/suspended_at (0003) rather than replacing them. profiles.status remains the authoritative current-state column; this table explains why/until-when.';

create index idx_user_suspensions_user_id on user_suspensions (user_id, created_at desc);
create index idx_user_suspensions_active_expiring on user_suspensions (expires_at) where status = 'active' and expires_at is not null;

alter table user_suspensions enable row level security;
alter table user_suspensions force row level security;

create policy user_suspensions_select_own on user_suspensions for select using (user_id = auth.uid());
create policy user_suspensions_select_staff on user_suspensions for select using (is_admin() or is_moderator());
-- No client insert/update/delete: matches wallet_adjustment_requests (0038)
-- and moderator_actions (0009) -- moderator-issued state changes go through
-- an Edge Function (service_role), never a direct client table write.

-- fn_expire_temporary_suspensions --------------------------------------
-- Two-step by design: (1) mark every individually-expired active
-- suspension ROW as expired, so the historical record is accurate even
-- when a user has multiple overlapping suspensions; (2) only reinstate the
-- ACCOUNT (profiles.status) for a user once they have zero remaining
-- active suspensions, and only if their account is still 'suspended' --
-- never overwrite a 'closed' account back to 'active'.
create or replace function fn_expire_temporary_suspensions()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  for v_user_id in
    update user_suspensions
    set status = 'expired', lifted_at = now()
    where status = 'active'
      and expires_at is not null
      and expires_at <= now()
    returning user_id
  loop
    perform log_security_event(
      'SuspensionExpired',
      'user_suspensions',
      v_user_id::text,
      '{}'::jsonb
    );

    if not exists (
      select 1 from user_suspensions
      where user_id = v_user_id and status = 'active'
    ) then
      update profiles
      set status = 'active'
      where id = v_user_id and status = 'suspended';
      -- profiles' own trg_audit_profile_status_change (0025) fires here
      -- automatically and logs the AccountStatusChanged event; no
      -- duplicate audit call needed for the account-level transition.
    end if;
  end loop;
end;
$$;
comment on function fn_expire_temporary_suspensions() is
  'Expires due user_suspensions rows and reinstates the account once no active suspension remains. Invoked directly by pg_cron below (not via an HTTP-callout Edge Function like other schedulers, e.g. 0045/0048/0054/0061/0064) because this operation is self-contained SQL state with no external orchestration need -- unlike e.g. challenge-expire, which must also release escrow.';

select cron.schedule(
  'user-suspension-auto-expire-every-5-minutes',
  '*/5 * * * *',
  $$ select fn_expire_temporary_suspensions(); $$
);
