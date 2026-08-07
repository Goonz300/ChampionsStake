-- ============================================================================
-- Migration 0100: Organizer Platform (Phase 8 TOURNAMENT-007)
--
-- Repository audit (Phase 8) found tournament-create is requireAdministrator-
-- gated -- createTournament's own parameter is literally named `adminId`,
-- actorType hardcoded to 'administrator'. There is no self-service
-- tournament creation at all today; every tournament on this platform must
-- be created by platform staff. This is the real, evidenced gap the
-- Organizer Platform milestone addresses.
--
-- 'organizer' is added to user_role (additive) rather than inventing a
-- separate grants table -- matches the existing player/moderator/
-- administrator role model exactly, admin-granted (same trust posture as
-- moderator status: NOT self-service, since organizers create real-money
-- tournaments with entry fees/prize pools, and this platform's fraud/risk
-- apparatus has no track record yet for a fully open self-service model).
-- Administrators keep full tournament-creation capability unchanged --
-- this is additive, not a replacement of the existing admin path.
--
-- visibility/is_recurring/recurrence_rule/sponsor_* are added directly to
-- tournaments (additive columns) rather than a parallel "organizer
-- tournaments" table -- an organizer-created tournament and an
-- admin-created one are still fundamentally the same tournaments row.
-- ============================================================================

alter type user_role add value if not exists 'organizer';

create type tournament_visibility as enum ('public', 'private', 'invite_only');

alter table tournaments add column visibility tournament_visibility not null default 'public';
alter table tournaments add column is_recurring boolean not null default false;
alter table tournaments add column recurrence_rule text; -- free-text cadence description (e.g. "weekly"), not a full RRULE parser -- see docs/ORGANIZER_PLATFORM_DESIGN.md
alter table tournaments add column template_id uuid;
alter table tournaments add column sponsor_name text;
alter table tournaments add column sponsor_logo_url text;

create index idx_tournaments_visibility on tournaments (visibility);

create table tournament_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references profiles (id),
  game_id uuid not null references games (id),
  format tournament_format not null,
  entry_fee_cents integer not null default 0,
  payout_structure jsonb not null default '{}'::jsonb,
  visibility tournament_visibility not null default 'public',
  is_recurring boolean not null default false,
  recurrence_rule text,
  sponsor_name text,
  sponsor_logo_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table tournament_templates is
  'Reusable tournament presets an organizer spawns new tournaments from (Phase 8 TOURNAMENT-007) -- "Tournament templates" and, combined with recurrence_rule, "Recurring tournaments".';

alter table tournaments add constraint fk_tournaments_template_id
  foreign key (template_id) references tournament_templates (id);

create index idx_tournament_templates_created_by on tournament_templates (created_by);

create trigger trg_tournament_templates_updated_at before update on tournament_templates
  for each row execute function fn_set_updated_at();

create type tournament_invitation_status as enum ('pending', 'accepted', 'declined');

create table tournament_invitations (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments (id) on delete cascade,
  invited_user_id uuid not null references profiles (id),
  invited_by uuid not null references profiles (id),
  status tournament_invitation_status not null default 'pending',
  created_at timestamptz not null default now(),
  responded_at timestamptz
);
comment on table tournament_invitations is
  'Invite-only tournament access (Phase 8 TOURNAMENT-007) -- same shape as team_invitations (migration 0094). registerForTournament requires an accepted row here when tournaments.visibility = ''invite_only''.';

create unique index uq_tournament_invitations_one_pending on tournament_invitations (tournament_id, invited_user_id) where status = 'pending';
create index idx_tournament_invitations_invited_user on tournament_invitations (invited_user_id, status);

alter table tournament_templates enable row level security;
alter table tournament_templates force row level security;
alter table tournament_invitations enable row level security;
alter table tournament_invitations force row level security;

create policy tournament_templates_select_own on tournament_templates for select using (
  created_by = auth.uid() or is_admin()
);
create policy tournament_invitations_select_own on tournament_invitations for select using (
  invited_user_id = auth.uid() or invited_by = auth.uid() or is_admin() or is_moderator()
);
-- No client writes: only tournament-organize (service_role) writes here.
