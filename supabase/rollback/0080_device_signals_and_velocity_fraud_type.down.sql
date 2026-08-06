-- Rollback 0080: Device Signal Expansion + Velocity Fraud Flag Type
-- Note: fraud_flag_type's new 'velocity_abuse' enum value cannot be
-- dropped by PostgreSQL (enum values cannot be removed once added) -- any
-- fraud_flags rows using it would need to be reassigned or deleted first,
-- and even then the value itself is permanent. Left in place on rollback,
-- matching every other enum extension in this schema (e.g. 0015, 0035).
drop policy if exists device_ip_history_select_own on device_ip_history;
drop policy if exists device_ip_history_select_staff on device_ip_history;
drop table if exists device_ip_history;
alter table devices drop column if exists country_code;
alter table devices drop column if exists last_ip_address;
