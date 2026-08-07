-- Rollback 0096: Season Lifecycle
alter table seasons drop column if exists reward_structure;
-- transaction_type's 'season_reward' value cannot be dropped (Postgres
-- does not support removing enum values); same documented limitation as
-- every prior enum-extension rollback in this repo.
