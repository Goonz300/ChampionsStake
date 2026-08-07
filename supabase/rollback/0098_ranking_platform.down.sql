-- Rollback 0098: Ranking Platform
drop table if exists rating_history;
drop table if exists player_ratings;
drop type if exists rating_scope_type;
drop type if exists rating_system;
