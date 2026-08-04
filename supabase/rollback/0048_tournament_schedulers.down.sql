-- Rollback 0048: Tournament Schedulers
select cron.unschedule('tournament-archive-daily');
