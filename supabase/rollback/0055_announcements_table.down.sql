-- Rollback 0055: Announcements Table
drop policy if exists announcements_write_admin on announcements;
drop policy if exists announcements_select_admin on announcements;
drop policy if exists announcements_select_published on announcements;
drop trigger if exists trg_announcements_updated_at on announcements;
drop table if exists announcements;
drop type if exists announcement_status;
drop type if exists announcement_category;
