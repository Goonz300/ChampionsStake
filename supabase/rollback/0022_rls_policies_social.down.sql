-- Rollback 0022: RLS Policies — Notifications, Friends, Reports
drop policy if exists reports_update_staff on reports;
drop policy if exists reports_insert_own on reports;
drop policy if exists reports_select_staff on reports;
drop policy if exists reports_select_own on reports;
drop policy if exists friends_update_involved on friends;
drop policy if exists friends_insert_own on friends;
drop policy if exists friends_select_own on friends;
drop policy if exists notifications_update_own_read_status on notifications;
drop policy if exists notifications_select_own on notifications;
