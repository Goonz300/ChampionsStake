-- Rollback 0104: Phase 8 performance indexes
drop index if exists idx_tournaments_created_by_game_id;
drop index if exists idx_season_participants_team_id;
drop index if exists idx_season_participants_user_id;
drop index if exists idx_seasons_status_ends_at;
