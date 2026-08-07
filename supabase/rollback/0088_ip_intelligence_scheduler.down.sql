-- Rollback 0088: IP Intelligence Scheduler
select cron.unschedule('ai-ip-intelligence-every-6-hours');
