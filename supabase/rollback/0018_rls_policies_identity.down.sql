-- Rollback 0018: RLS Policies — Identity
revoke select on v_public_profiles from anon, authenticated;
drop view if exists v_public_profiles;
drop policy if exists system_settings_update_admin on system_settings;
drop policy if exists system_settings_select_staff on system_settings;
drop policy if exists user_sessions_select_self_or_admin on user_sessions;
drop policy if exists devices_select_self_or_staff on devices;
drop policy if exists profiles_update_staff on profiles;
drop policy if exists profiles_update_self on profiles;
drop policy if exists profiles_select_self_or_staff on profiles;
