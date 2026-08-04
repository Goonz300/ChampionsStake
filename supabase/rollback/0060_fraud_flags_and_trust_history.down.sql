-- Rollback 0060: Fraud Flags & Trust Score History
drop policy if exists trust_score_history_select_staff on trust_score_history;
drop policy if exists trust_score_history_select_own on trust_score_history;
drop table if exists trust_score_history;
drop policy if exists fraud_flags_update_staff on fraud_flags;
drop policy if exists fraud_flags_select_staff on fraud_flags;
drop table if exists fraud_flags;
drop type if exists fraud_flag_status;
drop type if exists fraud_flag_type;
