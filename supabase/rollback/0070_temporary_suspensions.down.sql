-- Rollback 0070: Temporary Suspensions
select cron.unschedule('user-suspension-auto-expire-every-5-minutes');
drop function if exists fn_expire_temporary_suspensions();
drop table if exists user_suspensions;
drop type if exists user_suspension_status;
