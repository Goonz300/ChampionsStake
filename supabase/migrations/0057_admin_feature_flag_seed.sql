-- ============================================================================
-- Migration 0057: Additional Feature Flag Seed Data
--
-- DB-001's original seed (migration 0014) covered 5 flags. This phase's
-- brief names several more explicitly (RealMoney, Chat, Maintenance Mode,
-- Experimental Features) that were never seeded — including
-- 'maintenance_mode', which AUTH-001's middleware.ts has queried for since
-- that phase but which never actually existed as a row (handled gracefully
-- via absence-means-false, but better to actually seed it now that an
-- admin UI exists to toggle it).
-- ============================================================================

insert into feature_flags (key, description, enabled, requires_dual_approval) values
  ('real_money_enabled', 'Master switch for all real-money features (deposits, withdrawals, stakes). Requires dual approval.', false, true),
  ('chat_enabled', 'Allow challenge chat (REALTIME-001).', true, false),
  ('maintenance_mode', 'Platform-wide maintenance mode — redirects all traffic to /maintenance (AUTH-001 middleware.ts).', false, false),
  ('experimental_features_enabled', 'Master switch for features still in internal testing.', false, false)
on conflict (key) do nothing;
