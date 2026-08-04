-- Rollback 0054: Realtime Platform Schedulers
select cron.unschedule('notification-dispatch-every-minute');
