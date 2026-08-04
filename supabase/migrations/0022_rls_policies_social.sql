-- ============================================================================
-- Migration 0022: RLS Policies — Notifications, Friends, Reports
-- ============================================================================

-- notifications -----------------------------------------------------------
create policy notifications_select_own on notifications
  for select
  using (user_id = auth.uid());

create policy notifications_update_own_read_status on notifications
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
  -- Restricted to status/read_at only via fn_notifications_read_status_only_guard
  -- (migration 0025) — a user may mark their own notification read, nothing else.

-- No client INSERT/DELETE — notifications are system-generated
-- (notification-dispatch Edge Function, service_role) and are never deleted
-- (kept for the user's own history).

-- friends -----------------------------------------------------------------
create policy friends_select_own on friends
  for select
  using (requester_id = auth.uid() or addressee_id = auth.uid());

create policy friends_insert_own on friends
  for insert
  with check (requester_id = auth.uid());

create policy friends_update_involved on friends
  for update
  using (requester_id = auth.uid() or addressee_id = auth.uid())
  with check (requester_id = auth.uid() or addressee_id = auth.uid());
  -- Covers accept/decline (addressee) and a requester withdrawing their own
  -- pending request. Status-value legality (e.g. can't set your own request
  -- straight to 'blocked' as the requester) is enforced by
  -- fn_friends_status_transition_guard (migration 0025).

-- reports -------------------------------------------------------------------
create policy reports_select_own on reports
  for select
  using (reporter_id = auth.uid());

create policy reports_select_staff on reports
  for select
  using (is_admin() or is_moderator());

create policy reports_insert_own on reports
  for insert
  with check (reporter_id = auth.uid());

create policy reports_update_staff on reports
  for update
  using (is_admin() or is_moderator())
  with check (is_admin() or is_moderator());
