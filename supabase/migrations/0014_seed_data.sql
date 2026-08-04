-- ============================================================================
-- Migration 0014: Seed Data
-- Safe to run multiple times (idempotent upserts). No user/financial data.
-- ============================================================================

-- platforms -----------------------------------------------------------------
insert into platforms (code, name) values
  ('pc', 'PC'),
  ('playstation', 'PlayStation'),
  ('xbox', 'Xbox'),
  ('nintendo_switch', 'Nintendo Switch'),
  ('mobile', 'Mobile'),
  ('cross_platform', 'Cross-Platform')
on conflict (code) do nothing;

-- regions ---------------------------------------------------------------
insert into regions (code, name) values
  ('na', 'North America'),
  ('eu', 'Europe'),
  ('apac', 'Asia-Pacific'),
  ('latam', 'Latin America'),
  ('mena', 'Middle East & North Africa'),
  ('oceania', 'Oceania'),
  ('global', 'Global / Any Region')
on conflict (code) do nothing;

-- games -------------------------------------------------------------------
insert into games (name, slug, supported_platform_codes) values
  ('Valorant', 'valorant', array['pc']),
  ('League of Legends', 'league-of-legends', array['pc']),
  ('Call of Duty', 'call-of-duty', array['pc', 'playstation', 'xbox']),
  ('EA Sports FC', 'ea-sports-fc', array['pc', 'playstation', 'xbox']),
  ('Fortnite', 'fortnite', array['pc', 'playstation', 'xbox', 'nintendo_switch', 'mobile']),
  ('Rocket League', 'rocket-league', array['pc', 'playstation', 'xbox', 'nintendo_switch']),
  ('Apex Legends', 'apex-legends', array['pc', 'playstation', 'xbox']),
  ('Counter-Strike 2', 'counter-strike-2', array['pc'])
on conflict (slug) do nothing;

-- feature_flags -------------------------------------------------------------
-- withdrawals_enabled/kyc/geofencing default OFF: per the Readiness Report
-- and Roadmap's recommended safe build order, real-money withdrawal must not
-- go live before KYC (Phase 5) and Moderator tooling (Phase 6) exist.
insert into feature_flags (key, description, enabled, requires_dual_approval) values
  ('deposits_enabled', 'Allow new wallet deposits.', false, false),
  ('withdrawals_enabled', 'Allow wallet withdrawals. Requires KYC (Phase 5) and Moderator tooling (Phase 6) to exist first.', false, true),
  ('challenge_creation_enabled', 'Allow creation of new challenges.', false, false),
  ('tournaments_enabled', 'Allow tournament registration and play.', false, false),
  ('ai_recommendations_enabled', 'Enable opponent recommendation / trust-score AI features.', false, false)
on conflict (key) do nothing;

-- system_settings -------------------------------------------------------
-- Values sourced directly from Business Rules v1.0 §6, §16, §19.
insert into system_settings (key, value, description) values
  ('stake_min_cents', '500', 'Minimum challenge stake (Business Rules §19): $5.'),
  ('stake_max_cents_pre_kyc', '200000', 'Maximum challenge stake before KYC tier upgrade (Business Rules §19): $2,000.'),
  ('deposit_min_cents', '500', 'Minimum deposit (Business Rules §6): $5.'),
  ('deposit_max_cents_per_txn', '200000', 'Maximum deposit per transaction (Business Rules §6): $2,000.'),
  ('deposit_max_cents_rolling_24h', '500000', 'Maximum rolling 24h deposit total (Business Rules §6): $5,000.'),
  ('withdrawal_min_cents', '1000', 'Minimum withdrawal (Business Rules §6): $10.'),
  ('kyc_pre_verification_stake_cap_cents', '10000', 'Lifetime un-KYC''d stake exposure cap (Business Rules §2): $100.'),
  ('challenge_publish_expiry_hours', '48', 'Unaccepted published challenge expiry (Business Rules §16).'),
  ('opponent_stake_capture_timeout_minutes', '10', 'Window for opponent stake capture after accept (Business Rules §16).'),
  ('ready_check_timeout_minutes', '10', 'Ready-check window (Business Rules §16).'),
  ('winner_submitted_response_hours', '24', 'Window before auto-escalation to moderator review (Business Rules §16).'),
  ('dispute_evidence_window_hours', '48', 'Shared evidence submission window (Business Rules §16).'),
  ('moderator_review_sla_hours', '24', 'Moderator review SLA before an admin alert fires (Business Rules §16).'),
  ('appeal_window_hours', '72', 'Appeal filing window after a decision (Business Rules §16).'),
  ('tournament_check_in_window_minutes', '30', 'Tournament check-in window before start (Business Rules §16).'),
  ('pending_deposit_auto_reversal_hours', '24', 'Auto-reversal window for unconfirmed deposits (Business Rules §16).'),
  ('email_verification_link_expiry_hours', '24', 'Email verification token expiry (Business Rules §16).'),
  ('platform_fee_percent', '7.5', 'Default platform fee taken at escrow release (Business Rules §6): 5-10% range, default 7.5%.')
on conflict (key) do nothing;
