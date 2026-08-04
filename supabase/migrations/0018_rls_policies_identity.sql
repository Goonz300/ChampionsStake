-- ============================================================================
-- Migration 0018: RLS Policies — Identity
-- Tables: profiles, devices, user_sessions, system_settings
-- Plus: v_public_profiles view (see design note below).
-- ============================================================================

-- profiles --------------------------------------------------------------
-- DESIGN NOTE: Postgres RLS is row-level only — it cannot hide individual
-- columns of a row a user IS allowed to see. Since profiles holds both
-- self-only-sensitive fields (kyc_provider_ref, suspended_reason_code) and
-- fields that should be publicly browsable (display_name, trust_score), the
-- base table's SELECT policy is restricted to self + moderator/admin/support
-- only, and a separate `v_public_profiles` view (below) exposes just the
-- safe columns to everyone, including anon. All "browse other players"
-- queries must go through the view, never the base table.
create policy profiles_select_self_or_staff on profiles
  for select
  using (id = auth.uid() or is_admin() or is_moderator() or is_support());

create policy profiles_update_self on profiles
  for update
  using (id = auth.uid())
  with check (id = auth.uid());
  -- Column-level guard (role/status/kyc_status/trust_score are not
  -- self-editable) is enforced by fn_profiles_self_update_guard in
  -- migration 0025 — RLS alone cannot restrict which columns a self-update
  -- may touch.

create policy profiles_update_staff on profiles
  for update
  using (is_admin() or is_moderator())
  with check (is_admin() or is_moderator());

-- No INSERT policy for authenticated/anon: profile rows are created by a
-- trigger on auth.users (wired up in Phase 3, Authentication) running as
-- service_role, never directly by a client.
-- No DELETE policy at all: account closure is a status change
-- (status='closed'), never a row deletion (Business Rules §2, §15).

create view v_public_profiles as
select id, display_name, avatar_url, role, trust_score, completion_rate, created_at
from profiles
where status = 'active';
comment on view v_public_profiles is
  'Public-safe projection of profiles for browsing/opponent-recommendation queries. Bypasses the base table''s self-only RLS by design (view owner privilege) — this is the ONLY sanctioned way to read another user''s profile data.';

grant select on v_public_profiles to anon, authenticated;

-- devices -----------------------------------------------------------------
create policy devices_select_self_or_staff on devices
  for select
  using (user_id = auth.uid() or is_admin() or is_support());
-- No client INSERT/UPDATE/DELETE — fingerprints are recorded server-side
-- (Edge Function using service_role) at login/registration time.

-- user_sessions -------------------------------------------------------------
create policy user_sessions_select_self_or_admin on user_sessions
  for select
  using (user_id = auth.uid() or is_admin());
-- No client INSERT/UPDATE/DELETE — sessions are managed entirely by
-- Supabase Auth / server-side session middleware.

-- system_settings -----------------------------------------------------------
-- Internal configuration values; not exposed to ordinary players (the API
-- surfaces relevant limits inline in validation error messages instead of
-- requiring clients to query this table).
create policy system_settings_select_staff on system_settings
  for select
  using (is_admin() or is_moderator());

create policy system_settings_update_admin on system_settings
  for update
  using (is_admin())
  with check (is_admin());
