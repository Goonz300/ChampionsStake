-- Rollback 0024: RLS Policies — Audit Logs & Feature Flags
drop policy if exists feature_flags_update_admin on feature_flags;
drop policy if exists feature_flags_select_all on feature_flags;
drop policy if exists audit_logs_select_admin on audit_logs;
