-- ============================================================================
-- Migration 0016: Security Helper Functions
--
-- DESIGN NOTE: every function below queries `profiles` (or the relevant
-- table) live using auth.uid() — none of them read JWT custom claims. A
-- suspended administrator's existing JWT could still claim app_role=admin
-- for up to 15 minutes (Architecture §8 token lifetime); querying profiles
-- fresh means their access is revoked the instant profiles.status is set to
-- 'suspended', not whenever their token happens to expire. This is the
-- concrete mechanism behind "the database must always be the final
-- authority" from this phase's mission statement.
--
-- All functions are `stable` (safe to use in RLS policies, cacheable within
-- a single statement) and `security definer` where they need to read tables
-- the calling role wouldn't otherwise have SELECT on directly (e.g. a player
-- checking is_moderator() doesn't need direct SELECT access to other users'
-- profiles rows).
-- ============================================================================

create or replace function current_user_id()
returns uuid
language sql
stable
as $$
  select auth.uid();
$$;
comment on function current_user_id() is 'Thin wrapper over auth.uid(), used for readability in policies.';

create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid()
      and role = 'administrator'
      and status = 'active'
  );
$$;
comment on function is_admin() is 'True if the current user is an active administrator. Reads profiles fresh, never a JWT claim.';

create or replace function is_moderator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid()
      and role in ('moderator', 'administrator')
      and status = 'active'
  );
$$;
comment on function is_moderator() is 'True if the current user is an active moderator OR administrator (admins are a superset, Business Rules §11).';

create or replace function is_support()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid()
      and role in ('support', 'administrator')
      and status = 'active'
  );
$$;
comment on function is_support() is 'True if the current user is active support staff or an administrator. Read-only privilege level.';

create or replace function is_verified()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid()
      and kyc_status = 'verified'
      and status = 'active'
  );
$$;
comment on function is_verified() is 'True if the current user has completed KYC (Business Rules §2).';

create or replace function is_active_player()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid()
      and status = 'active'
  );
$$;
comment on function is_active_player() is 'True if the current user''s account is active (not unverified/suspended/closed).';

create or replace function owns_wallet(p_wallet_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from wallets
    where id = p_wallet_id
      and user_id = auth.uid()
  );
$$;
comment on function owns_wallet(uuid) is 'True if the current user owns the given wallet.';

create or replace function owns_challenge(p_challenge_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from challenges
    where id = p_challenge_id
      and creator_id = auth.uid()
  );
$$;
comment on function owns_challenge(uuid) is 'True if the current user is specifically the CREATOR of the given challenge (narrower than participant).';

create or replace function is_challenge_participant(p_challenge_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from challenge_participants
    where challenge_id = p_challenge_id
      and user_id = auth.uid()
  );
$$;
comment on function is_challenge_participant(uuid) is 'True if the current user is either side (creator or opponent) of the given challenge.';

create or replace function is_dispute_participant(p_dispute_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from disputes d
    join challenge_participants cp on cp.challenge_id = d.challenge_id
    where d.id = p_dispute_id
      and cp.user_id = auth.uid()
  );
$$;
comment on function is_dispute_participant(uuid) is 'True if the current user is a participant in the challenge underlying the given dispute.';

create or replace function is_assigned_moderator(p_dispute_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from disputes
    where id = p_dispute_id
      and assigned_moderator_id = auth.uid()
  );
$$;
comment on function is_assigned_moderator(uuid) is 'True if the current user is the moderator assigned to the given dispute.';

create or replace function can_submit_proof(p_dispute_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from disputes d
    join challenge_participants cp on cp.challenge_id = d.challenge_id
    where d.id = p_dispute_id
      and cp.user_id = auth.uid()
      and d.status in ('open', 'under_review')
  );
  -- Note: the 48h evidence-window cutoff (Business Rules §9/§16) is treated
  -- as a soft business rule enforced by the Edge Function layer, which can
  -- still accept late evidence at a moderator's discretion (Business Rules
  -- §9: "disputing after the window is still accepted..."). RLS enforces
  -- *who* may submit, not the timing nuance, which needs judgment a rigid
  -- policy shouldn't hard-code.
$$;
comment on function can_submit_proof(uuid) is 'True if the current user is a participant in an open/under-review dispute.';

create or replace function can_release_escrow(p_challenge_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from challenges
    where id = p_challenge_id
      and status in ('winner_submitted', 'awaiting_confirmation')
      and winner_submitted_by is distinct from auth.uid()
      and exists (
        select 1 from challenge_participants
        where challenge_id = p_challenge_id and user_id = auth.uid()
      )
  );
$$;
comment on function can_release_escrow(uuid) is
  'True only for the non-claiming participant (Business Rules §7 — a claiming party can never self-release their own claim).';

create or replace function log_security_event(
  p_action text,
  p_target_table text,
  p_target_id text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform fn_write_audit_log(
    auth.uid(),
    case
      when is_admin() then 'administrator'
      when is_moderator() then 'moderator'
      when auth.uid() is not null then 'user'
      else 'system'
    end::actor_type,
    p_action,
    'system'::audit_action_category,
    p_target_table,
    p_target_id,
    p_metadata
  );
end;
$$;
comment on function log_security_event(text, text, text, jsonb) is
  'Convenience wrapper around fn_write_audit_log for security-relevant events raised from within triggers/policies.';
