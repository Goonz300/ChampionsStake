-- Rollback 0021: RLS Policies — Tournaments
drop policy if exists tournament_matches_select_all on tournament_matches;
drop policy if exists tournament_rounds_select_all on tournament_rounds;
drop policy if exists tournament_registrations_select_staff on tournament_registrations;
drop policy if exists tournament_registrations_select_own on tournament_registrations;
drop policy if exists tournaments_write_admin on tournaments;
drop policy if exists tournaments_select_all on tournaments;
