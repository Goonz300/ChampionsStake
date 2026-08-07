-- Rollback 0095: League & Season Platform
drop table if exists season_participants;
drop table if exists seasons;
drop table if exists divisions;
drop table if exists leagues;
drop type if exists season_status;
drop type if exists league_status;
