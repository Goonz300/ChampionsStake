-- Rollback 0106: Challenge browse indexes
drop index if exists idx_challenges_visibility_status_stake_cents;
drop index if exists idx_challenges_visibility_status_created_at;
