-- Rollback 0090: Reputation Engine Scheduler
select cron.unschedule('ai-reputation-engine-every-30-minutes');
