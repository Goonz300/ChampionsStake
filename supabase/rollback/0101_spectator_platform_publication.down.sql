-- Rollback 0101: Spectator Platform
alter publication supabase_realtime drop table team_members;
alter publication supabase_realtime drop table player_ratings;
alter publication supabase_realtime drop table season_participants;
alter publication supabase_realtime drop table tournament_registrations;
alter publication supabase_realtime drop table tournaments;

drop policy if exists tournament_registrations_select_all on tournament_registrations;
