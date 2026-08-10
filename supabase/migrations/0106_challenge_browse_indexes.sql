-- 0106_challenge_browse_indexes.sql
--
-- Phase 8.5 database production review finding: challenge-browse's
-- discovery query (_challenge/workflow.ts's browseChallenges) always
-- filters `status IN ('published','waiting') AND visibility = 'public'`,
-- then sorts by created_at desc (the default, and every "newest"/
-- "trending"/"recommended" fallback) or stake_cents desc ("highest_prize").
-- The only existing index on this table leading with a query-relevant
-- column is idx_challenges_status_game_id (status, game_id) -- it doesn't
-- cover visibility at all, and covers neither sort column, so the
-- platform's main public discovery endpoint has always had to filter and
-- sort challenges without index support for its most common shape. This
-- is additive only -- no existing index is touched or replaced.
create index idx_challenges_visibility_status_created_at
  on challenges (visibility, status, created_at desc);

create index idx_challenges_visibility_status_stake_cents
  on challenges (visibility, status, stake_cents desc);
