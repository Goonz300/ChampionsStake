-- Rollback 0061: AI Platform Schedulers
select cron.unschedule('ai-fraud-scan-hourly');
select cron.unschedule('ai-trust-score-every-10-minutes');
