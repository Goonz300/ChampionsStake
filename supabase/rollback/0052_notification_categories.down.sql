-- Rollback 0052: Notification Categories
drop index if exists idx_notifications_user_category;
alter table notifications drop column if exists category;
drop type if exists notification_category;
