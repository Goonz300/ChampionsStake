-- Rollback 0079: Login Lockouts
drop policy if exists login_lockouts_select_staff on login_lockouts;
drop table if exists login_lockouts;
