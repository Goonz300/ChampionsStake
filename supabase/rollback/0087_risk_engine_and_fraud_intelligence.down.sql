-- Rollback 0087: Risk Engine + Fraud Intelligence Expansion
drop function if exists fn_classify_ip(inet);
drop table if exists datacenter_ip_ranges;
drop table if exists tor_exit_nodes;

alter table device_ip_history drop column if exists is_datacenter;
alter table device_ip_history drop column if exists is_tor;

-- fraud_flag_type additions cannot be dropped (Postgres does not support
-- removing enum values); same documented limitation as migration 0080's
-- rollback for 'velocity_abuse'. Harmless no-op values if this rollback runs.

drop table if exists risk_scores;
drop type if exists risk_subject_type;
