-- ============================================================================
-- Migration 0027: User Preferences Table
--
-- SCOPE NOTE: this is the one schema change in this phase, and it qualifies
-- as "a verified implementation issue" rather than a redesign: the API
-- Specification promises USER-EP-05 (get/update preferences) and
-- NOTIF-EP-03 (update notification preferences), and this phase's Step 7
-- explicitly requires "Create preferences, notification settings, privacy
-- settings" automatically at registration — but no table for any of this
-- exists in DB-001. Rather than three near-identical tables, one table with
-- three jsonb sub-objects covers the same ground with less schema churn and
-- no join needed to read a user's full settings in one query.
-- ============================================================================

create table user_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references profiles (id) on delete cascade,
  notification_preferences jsonb not null default '{
    "challenge_updates": {"push": true, "email": true},
    "wallet_updates": {"push": true, "email": true},
    "dispute_updates": {"push": true, "email": true},
    "tournament_updates": {"push": true, "email": false},
    "social_updates": {"push": true, "email": false},
    "marketing": {"push": false, "email": false}
  }'::jsonb,
  privacy_preferences jsonb not null default '{
    "show_trust_score_publicly": true,
    "show_activity_to_friends_only": false
  }'::jsonb,
  gaming_preferences jsonb not null default '{
    "preferred_platforms": [],
    "preferred_regions": [],
    "preferred_games": []
  }'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table user_preferences is
  'Consolidated notification/privacy/gaming preferences per user (Business Rules §12 notification categories, mirrors the existing Settings UI tabs from the approved prototype). Created automatically at registration (this phase''s identity-sync trigger).';

create trigger trg_user_preferences_updated_at before update on user_preferences
  for each row execute function fn_set_updated_at();
