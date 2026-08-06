-- Rollback 0076: Email Queue Scheduler
select cron.unschedule('email-queue-process-every-minute');
