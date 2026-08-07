-- Rollback 0099: Ranking Engine Scheduler
select cron.unschedule('ranking-engine-every-10-minutes');
