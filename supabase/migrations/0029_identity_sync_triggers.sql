-- ============================================================================
-- Migration 0029: Identity Synchronization Triggers
--
-- Wires auth.users (Supabase Auth's own table) to ChampionsStake's identity
-- tables. This is the trigger DB-002's migration 0018 comment explicitly
-- deferred to "Phase 3, Authentication" — implementing it now, not before.
-- ============================================================================

-- fn_handle_new_user ------------------------------------------------------
-- AFTER INSERT on auth.users: creates the profile, wallet, and preferences
-- rows every new user needs. SECURITY DEFINER because auth.users triggers
-- run in a context that must be able to write across RLS-protected tables
-- regardless of who's "logged in" (there is no session yet at registration).
create or replace function fn_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_display_name text;
begin
  -- Prefer a display_name supplied at signup (raw_user_meta_data), falling
  -- back to the email's local part with a random suffix to satisfy the
  -- uq_profiles_display_name uniqueness constraint on first collision.
  v_display_name := coalesce(
    new.raw_user_meta_data ->> 'display_name',
    split_part(new.email, '@', 1)
  );

  insert into profiles (id, display_name, role, status, kyc_status)
  values (new.id, v_display_name, 'player', 'unverified', 'unverified')
  on conflict (id) do nothing;

  -- Business Rules §2: "Wallet Activation — auto-created at registration
  -- with $0 balance." Explicitly authorized by the approved business rules,
  -- per this phase's "only if defined in approved business rules" instruction.
  insert into wallets (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  insert into user_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  perform fn_write_audit_log(
    new.id, 'user'::actor_type, 'UserRegistered', 'auth'::audit_action_category,
    'profiles', new.id::text, jsonb_build_object('email', new.email)
  );

  return new;
exception
  when unique_violation then
    -- Display-name collision on the fallback path: retry once with a short
    -- random suffix rather than failing registration outright.
    insert into profiles (id, display_name, role, status, kyc_status)
    values (new.id, v_display_name || '-' || substr(new.id::text, 1, 4), 'player', 'unverified', 'unverified')
    on conflict (id) do nothing;

    insert into wallets (user_id) values (new.id) on conflict (user_id) do nothing;
    insert into user_preferences (user_id) values (new.id) on conflict (user_id) do nothing;

    return new;
end;
$$;

create trigger trg_auth_users_handle_new_user
  after insert on auth.users
  for each row execute function fn_handle_new_user();

-- fn_handle_user_email_verified ---------------------------------------------
-- AFTER UPDATE on auth.users: when email_confirmed_at flips from null to a
-- timestamp, mark the profile verified and active (Business Rules §2 —
-- unverified accounts can browse/edit profile only; verification unlocks
-- wallet/challenge eligibility).
create or replace function fn_handle_user_email_verified()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.email_confirmed_at is null and new.email_confirmed_at is not null then
    update profiles
      set email_verified_at = new.email_confirmed_at,
          status = case when status = 'unverified' then 'active' else status end
      where id = new.id;

    perform fn_write_audit_log(
      new.id, 'user'::actor_type, 'EmailVerified', 'auth'::audit_action_category,
      'profiles', new.id::text, '{}'::jsonb
    );
  end if;

  return new;
end;
$$;

create trigger trg_auth_users_handle_email_verified
  after update on auth.users
  for each row execute function fn_handle_user_email_verified();
