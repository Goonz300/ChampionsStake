-- Rollback 0075: Presence Tournament Support + Stale-Presence Sweep Schedule
select cron.unschedule('presence-sweep-every-minute');
drop policy if exists user_presence_select_tournament_participant on user_presence;
alter table user_presence drop column if exists current_tournament_id;
