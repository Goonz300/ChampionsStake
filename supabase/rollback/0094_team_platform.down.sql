-- Rollback 0094: Team Platform
alter table tournament_registrations drop column if exists team_id;

drop table if exists team_invitations;
drop table if exists team_members;
drop table if exists teams;

drop type if exists team_invitation_status;
drop type if exists team_member_role;
drop type if exists team_type;

-- audit_action_category's 'team' value cannot be dropped (Postgres does
-- not support removing enum values); same documented limitation as every
-- prior enum-extension rollback in this repo.
