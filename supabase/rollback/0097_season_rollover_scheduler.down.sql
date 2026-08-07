-- Rollback 0097: Season Rollover Scheduler
select cron.unschedule('season-rollover-hourly');
