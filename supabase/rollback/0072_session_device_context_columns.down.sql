-- Rollback 0072: Session/Device Context Columns
drop index if exists idx_user_sessions_device_id;
alter table user_sessions drop column if exists device_id;
alter table devices drop column if exists user_agent;
