-- ============================================================================
-- Migration 0028: RLS Policies — User Preferences
-- ============================================================================

alter table user_preferences enable row level security;
alter table user_preferences force row level security;

create policy user_preferences_select_own on user_preferences
  for select
  using (user_id = auth.uid());

create policy user_preferences_select_staff on user_preferences
  for select
  using (is_admin() or is_support());

create policy user_preferences_update_own on user_preferences
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- No client INSERT/DELETE — the row is created exactly once by the
-- identity-sync trigger (migration 0029) at registration, and is never
-- deleted (it cascades on profile deletion, which itself never happens —
-- accounts are closed, not deleted, per Business Rules §2).
