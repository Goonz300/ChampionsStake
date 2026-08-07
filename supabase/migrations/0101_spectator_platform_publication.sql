-- ============================================================================
-- Migration 0101: Spectator Platform (Phase 8 TOURNAMENT-008)
--
-- "Never build another websocket system" -- repository audit confirmed
-- tournament_rounds/tournament_matches are already in the supabase_realtime
-- publication (migration 0053); clients already subscribe via Postgres
-- Changes, the SAME mechanism this migration extends to the tables a
-- spectator's bracket/standings/leaderboard views need but weren't
-- streaming live yet. No new channel type, no new transport -- exactly
-- the existing Realtime infrastructure, more tables added to it.
--
-- Realtime respects RLS. team_members (migration 0094), season_participants
-- (0095), and player_ratings (0098) already have a public select-all
-- policy -- adding them here does not expose anything a client couldn't
-- already read via a normal query; it only makes changes push instead of
-- poll.
--
-- tournament_registrations is the one exception: migration 0021 scoped it
-- to tournament_registrations_select_own/_select_staff only (the
-- registrant themselves, or staff) -- narrower than tournament_rounds/
-- tournament_matches, which that SAME migration explicitly made public
-- ("Bracket structure is public browse data"). In practice this data is
-- ALREADY public: tournament-browse's participants/standings view reads
-- it via the service-role client (RLS-bypassing), for any caller, no
-- gating at all. A spectator subscribing directly via Postgres Changes
-- would be silently blocked by RLS despite that same data already being
-- openly readable through the Edge Function -- an inconsistency, not a
-- deliberate privacy boundary. Adding a public select policy (additive --
-- RLS policies are OR'd, so this only widens access, never narrows what
-- the existing two policies already allow) brings direct-subscription
-- access in line with what tournament-browse already serves.
create policy tournament_registrations_select_all on tournament_registrations
  for select
  using (true);

alter publication supabase_realtime add table tournaments;
alter publication supabase_realtime add table tournament_registrations;
alter publication supabase_realtime add table season_participants;
alter publication supabase_realtime add table player_ratings;
alter publication supabase_realtime add table team_members;
