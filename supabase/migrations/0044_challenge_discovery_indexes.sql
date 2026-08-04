-- ============================================================================
-- Migration 0044: Challenge Discovery Indexes
-- Supports the Discovery/Search/Filter features (trending, newest, highest
-- prize, region, platform, stake range) without a full-text search engine —
-- these are straightforward indexed equality/range filters.
-- ============================================================================

create index idx_challenges_status_created_at on challenges (status, created_at desc);
create index idx_challenges_status_stake_desc on challenges (status, stake_cents desc);
create index idx_challenges_region_platform on challenges (region_code, platform_code) where status in ('published', 'waiting');
