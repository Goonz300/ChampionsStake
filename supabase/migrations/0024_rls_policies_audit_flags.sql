-- ============================================================================
-- Migration 0024: RLS Policies — Audit Logs & Feature Flags
-- ============================================================================

-- audit_logs ------------------------------------------------------------
-- "Never accessible to normal users" — not even support (support gets
-- account/ticket visibility per the role hierarchy, not the full system
-- audit trail). Administrator only.
create policy audit_logs_select_admin on audit_logs
  for select
  using (is_admin());

-- No INSERT policy for authenticated/anon at all — the only sanctioned path
-- is fn_write_audit_log(), a SECURITY DEFINER function, or service_role
-- directly. No UPDATE/DELETE policy exists anywhere (immutable, and DB-001's
-- trigger blocks it as a second layer regardless).

-- feature_flags -----------------------------------------------------------
create policy feature_flags_select_all on feature_flags
  for select
  using (true);
  -- Non-sensitive; clients need to read these to gate UI (e.g.
  -- "tournaments_enabled"). Values contain no secrets.

create policy feature_flags_update_admin on feature_flags
  for update
  using (is_admin())
  with check (is_admin());
  -- The two-person approval requirement for requires_dual_approval=true
  -- flags (Business Rules §11) is enforced by
  -- fn_feature_flags_dual_approval_guard (migration 0025), since RLS alone
  -- can express "an admin may update" but not "a DIFFERENT admin must
  -- confirm."

-- No INSERT/DELETE policy: flags are provisioned via migration/seed data,
-- not created ad hoc by admins through the API.
