-- Rollback 0027: User Preferences Table
drop trigger if exists trg_user_preferences_updated_at on user_preferences;
drop table if exists user_preferences;
