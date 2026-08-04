-- ============================================================================
-- Migration 0015: Roles & JWT Claims
--
-- SCOPE NOTE: the brief for this phase says "do not modify the database
-- schema unless a verified security issue requires it." One schema change is
-- made below (adding 'support' to the user_role enum) and is called out
-- explicitly because it IS such a case: without it, support staff would have
-- to be granted the full 'administrator' role to do their job, which
-- violates the least-privilege requirement this phase is built around.
-- Adding an enum value is additive and backward-compatible — no existing
-- row, policy, or application code is affected.
-- ============================================================================

alter type user_role add value if not exists 'support';

comment on type user_role is
  'player: default role. moderator: dispute/void authority (Business Rules §10). '
  'administrator: full platform control incl. four-eyes wallet adjustments (Business Rules §11). '
  'support: read-only account/ticket visibility, no financial or moderation write authority — '
  'added in DB-002 to keep support staff off the administrator role (least privilege).';

-- ----------------------------------------------------------------------------
-- ROLE HIERARCHY (conceptual — documented here, enforced by helper functions
-- in migration 0016 and policies in 0017+). This maps the brief's 8 named
-- roles onto concrete Postgres/Supabase mechanisms:
--
--   Anonymous            -> Postgres role `anon` (Supabase built-in).
--                            No profiles row. Read-only access to public,
--                            non-sensitive data only (public challenges, games,
--                            leaderboard).
--
--   Authenticated Player -> Postgres role `authenticated` (Supabase built-in)
--                            + profiles.role = 'player'. Default state for
--                            every logged-in user.
--
--   Verified Player       -> Authenticated Player + profiles.kyc_status =
--                            'verified'. Not a separate Postgres role — a
--                            sub-state checked by the is_verified() helper,
--                            since KYC status can change independently of
--                            role and must be checked fresh, not cached.
--
--   Moderator            -> Postgres role `authenticated`
--                            + profiles.role = 'moderator'.
--                            Dispute/void authority (Business Rules §10).
--
--   Administrator        -> Postgres role `authenticated`
--                            + profiles.role = 'administrator'.
--                            Superset of moderator (Business Rules §11).
--
--   Support              -> Postgres role `authenticated`
--                            + profiles.role = 'support'.
--                            Read-only: can view user accounts, tickets,
--                            KYC status for troubleshooting — cannot adjust
--                            wallets, resolve disputes, or change feature
--                            flags. See is_support() in migration 0016.
--
--   System Service       -> Postgres role `service_role` (Supabase built-in).
--                            Used exclusively by Edge Functions. Bypasses RLS
--                            entirely per Supabase convention — this is the
--                            ONE place "trust" is placed, and only because
--                            service_role keys are never shipped to a client
--                            (Architecture §8: "service-role key only used
--                            inside Edge Functions, never shipped to client").
--
--   Future API Client    -> Not implemented in this phase. Architecture §7
--                            anticipates third-party integrations, but no
--                            API-key/OAuth-client table exists in DB-001, and
--                            creating one is a schema decision for a future
--                            Roadmap task, not something to improvise here.
--                            When it lands, it should get its own Postgres
--                            role scoped to read-only public endpoints only.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- JWT CLAIM SPECIFICATION
--
-- Supabase issues a JWT per session containing, at minimum, `sub` (the
-- user's auth.uid()) and `role` (always 'authenticated' for logged-in users
-- at the Postgres-role level — do not confuse this with profiles.role, the
-- ChampionsStake application role, which is a different value read separately).
--
-- Custom claims below are injected via a Supabase Auth Hook
-- (custom_access_token_hook, defined at the end of this file) so the client
-- can render UI without an extra round-trip. They are explicitly NOT the
-- authorization boundary — see the design note before the helper functions
-- in migration 0016 for why every privileged RLS policy re-reads `profiles`
-- live instead of trusting these claims.
--
--   claim              | source                          | purpose
--   -------------------|---------------------------------|---------------------------------
--   user_id            | auth.uid() (`sub`)               | identity — this one IS trusted,
--                      |                                  | it's the standard Supabase Auth
--                      |                                  | mechanism, not a custom claim.
--   app_role           | profiles.role at token-issue time | fast client-side UI gating hint.
--   verified           | profiles.kyc_status = 'verified'  | client-side gating hint only.
--   kyc_status         | profiles.kyc_status               | client-side display only.
--   trust_score        | profiles.trust_score              | client-side display only.
--   feature_flags      | enabled feature_flags at issue time| client-side feature gating hint.
--
-- Because these are snapshotted at token issuance (refreshed at most every
-- 15 minutes, Architecture §8), NONE of them are read by any RLS policy or
-- helper function in this migration set. A suspended moderator's stale JWT
-- claim would still say "moderator" for up to 15 minutes if we trusted it —
-- the helper functions in 0016 close that gap by querying profiles directly
-- on every check.
-- ----------------------------------------------------------------------------

create or replace function custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims jsonb;
  v_profile record;
  v_flags jsonb;
begin
  claims := event -> 'claims';

  select role, kyc_status, trust_score
    into v_profile
    from profiles
    where id = (event ->> 'user_id')::uuid;

  select coalesce(jsonb_object_agg(key, enabled), '{}'::jsonb)
    into v_flags
    from feature_flags;

  if v_profile is null then
    -- Auth user with no profile row yet (mid-registration). Emit safe defaults.
    claims := jsonb_set(claims, '{app_role}', to_jsonb('player'::text));
    claims := jsonb_set(claims, '{verified}', to_jsonb(false));
  else
    claims := jsonb_set(claims, '{app_role}', to_jsonb(v_profile.role::text));
    claims := jsonb_set(claims, '{verified}', to_jsonb(v_profile.kyc_status = 'verified'));
    claims := jsonb_set(claims, '{kyc_status}', to_jsonb(v_profile.kyc_status::text));
    claims := jsonb_set(claims, '{trust_score}', to_jsonb(v_profile.trust_score));
  end if;

  claims := jsonb_set(claims, '{feature_flags}', v_flags);

  event := jsonb_set(event, '{claims}', claims);
  return event;
end;
$$;
comment on function custom_access_token_hook(jsonb) is
  'Supabase Auth Hook: injects app_role/verified/kyc_status/trust_score/feature_flags into the JWT for client-side UI hints only. Never used as the authorization boundary — see helper functions in migration 0016.';

-- Supabase requires the auth admin role to be able to invoke this hook and
-- requires execute to be revoked from public roles to prevent misuse.
revoke execute on function custom_access_token_hook(jsonb) from public, anon, authenticated;
grant execute on function custom_access_token_hook(jsonb) to supabase_auth_admin;

-- OPERATIONAL NOTE (not SQL): after applying this migration, register the
-- hook in supabase/config.toml:
--   [auth.hook.custom_access_token]
--   enabled = true
--   uri = "pg-functions://postgres/public/custom_access_token_hook"
-- This is a project-configuration step, not something expressible in a SQL
-- migration file, and is documented here so it isn't missed.
