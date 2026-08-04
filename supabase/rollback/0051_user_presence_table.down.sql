-- Rollback 0051: User Presence Table
drop policy if exists user_presence_select_challenge_participant on user_presence;
drop policy if exists user_presence_select_own on user_presence;
revoke select on v_public_presence from anon, authenticated;
drop view if exists v_public_presence;
drop trigger if exists trg_user_presence_updated_at on user_presence;
drop table if exists user_presence;
drop type if exists presence_status;
