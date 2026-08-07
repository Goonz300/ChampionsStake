-- Rollback 0100: Organizer Platform
drop table if exists tournament_invitations;
drop type if exists tournament_invitation_status;

alter table tournaments drop constraint if exists fk_tournaments_template_id;
drop table if exists tournament_templates;

alter table tournaments drop column if exists sponsor_logo_url;
alter table tournaments drop column if exists sponsor_name;
alter table tournaments drop column if exists template_id;
alter table tournaments drop column if exists recurrence_rule;
alter table tournaments drop column if exists is_recurring;
alter table tournaments drop column if exists visibility;
drop type if exists tournament_visibility;

-- user_role's 'organizer' value cannot be dropped (Postgres does not
-- support removing enum values); same documented limitation as every
-- prior enum-extension rollback in this repo.
