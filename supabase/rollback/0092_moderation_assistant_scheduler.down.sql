-- Rollback 0092: AI Moderation Assistant Scheduler
select cron.unschedule('ai-moderation-assistant-every-15-minutes');
