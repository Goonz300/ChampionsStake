-- Rollback 0102: Tournament Scheduling Sweep
select cron.unschedule('tournament-scheduling-sweep-every-5-minutes');
