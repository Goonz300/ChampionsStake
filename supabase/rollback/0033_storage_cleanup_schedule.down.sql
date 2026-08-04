-- Rollback 0033: Storage Cleanup Schedule
select cron.unschedule('storage-cleanup-every-6-hours');
-- Extensions (pg_cron, pg_net) are left enabled intentionally — other
-- scheduled jobs in the project may depend on them; see the same reasoning
-- in 0001_extensions.down.sql.
