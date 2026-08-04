-- Rollback 0044: Challenge Discovery Indexes
drop index if exists idx_challenges_region_platform;
drop index if exists idx_challenges_status_stake_desc;
drop index if exists idx_challenges_status_created_at;
