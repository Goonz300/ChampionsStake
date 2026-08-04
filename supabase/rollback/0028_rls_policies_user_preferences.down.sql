-- Rollback 0028: RLS Policies — User Preferences
drop policy if exists user_preferences_update_own on user_preferences;
drop policy if exists user_preferences_select_staff on user_preferences;
drop policy if exists user_preferences_select_own on user_preferences;
