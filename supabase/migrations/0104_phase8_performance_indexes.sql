-- 0104_phase8_performance_indexes.sql
--
-- Performance review finding: three Phase 8 hot-path queries filter on
-- columns with no supporting index -- each was already correct, just
-- unindexed, so this migration adds indexes only, no behavior change.
--
-- 1. seasons: _league/season-service.ts's rolloverDueSeasons() (run hourly
--    by the season-rollover cron, migration 0097) filters
--    status='active' AND ends_at <= now(), with no league_id in the
--    filter. The only existing index, idx_seasons_league_id_status
--    (migration 0095), leads with league_id and can't serve this query.
create index idx_seasons_status_ends_at on seasons (status, ends_at)
  where ends_at is not null;

-- 2. season_participants: _league/repository.ts's getHistoricalStandings()
--    filters by user_id or team_id alone (no season_id in the filter --
--    it's looking up a participant's history ACROSS seasons). Both
--    existing indexes (migration 0095) lead with season_id and don't serve
--    a user/team-first lookup.
create index idx_season_participants_user_id on season_participants (user_id)
  where user_id is not null;
create index idx_season_participants_team_id on season_participants (team_id)
  where team_id is not null;

-- 3. tournaments: no index on created_by existed at all. Two Phase 8 hot
--    paths filter on it: organizer-service.ts's getOrganizerDashboard()
--    (every dashboard load) and scheduling.ts's
--    checkOrganizerScheduleConflict() (created_by + game_id + status,
--    every tournament-creation attempt).
create index idx_tournaments_created_by_game_id on tournaments (created_by, game_id);
