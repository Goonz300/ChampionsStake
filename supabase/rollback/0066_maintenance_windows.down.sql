-- Rollback 0066: Maintenance Windows
drop table if exists maintenance_windows;
drop type if exists maintenance_window_status;
drop type if exists maintenance_schedule_type;
