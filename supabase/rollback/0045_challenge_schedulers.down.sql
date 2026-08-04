-- Rollback 0045: Challenge Lifecycle Schedulers
select cron.unschedule('challenge-archive-daily');
select cron.unschedule('challenge-expire-every-5-minutes');
