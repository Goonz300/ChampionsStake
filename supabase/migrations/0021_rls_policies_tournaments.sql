-- ============================================================================
-- Migration 0021: RLS Policies — Tournaments
-- ============================================================================

create policy tournaments_select_all on tournaments
  for select
  using (true);
  -- Tournaments are always public browse data (Business Rules §5); no
  -- private-tournament concept exists in the approved schema.

create policy tournaments_write_admin on tournaments
  for all
  using (is_admin())
  with check (is_admin());
  -- Matches API Spec TOUR-EP-01 (create is admin-only).

-- tournament_registrations ---------------------------------------------
create policy tournament_registrations_select_own on tournament_registrations
  for select
  using (user_id = auth.uid());

create policy tournament_registrations_select_staff on tournament_registrations
  for select
  using (is_admin() or is_moderator());

-- No client INSERT/UPDATE/DELETE policy: join/leave/check-in all move an
-- entry fee in or out of escrow (Business Rules §5), so they are performed
-- exclusively by Edge Functions (service_role), the same reasoning as the
-- challenges state-transition endpoints in migration 0020.

-- tournament_rounds / tournament_matches -----------------------------------
create policy tournament_rounds_select_all on tournament_rounds
  for select
  using (true);

create policy tournament_matches_select_all on tournament_matches
  for select
  using (true);
  -- Bracket structure is public browse data. The underlying challenge row
  -- for a given match still enforces its own RLS (migration 0020) for
  -- anything beyond the bracket position itself (e.g. private chat).

-- No client writes to rounds/matches — bracket generation is a system/admin
-- Edge Function process (Roadmap TOUR-001).
