-- Rollback 0065: Notification Infrastructure
drop table if exists email_queue;
drop table if exists notification_templates;
drop table if exists push_tokens;
drop type if exists email_queue_status;
drop type if exists email_provider;
drop type if exists push_provider;
