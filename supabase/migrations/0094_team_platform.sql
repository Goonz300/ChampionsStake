-- ============================================================================
-- Migration 0094: Team Platform (Phase 8 TOURNAMENT-003)
--
-- SCOPE NOTE: the brief lists "Teams, Organizations, Clans" as separate
-- bullet items under one "Team Platform" milestone, without specifying how
-- they differ. Building three fully independent schemas (membership,
-- invitations, permissions each triplicated) would be substantial
-- unrequested complexity for a distinction the brief never actually
-- defines. This is modeled as ONE entity (teams) with a team_type
-- discriminator ('team' | 'organization' | 'clan') and an optional
-- self-referencing parent_organization_id -- an organization can own
-- multiple teams (e.g. "Team Liquid" the org fielding separate rosters per
-- game), a clan/team is a leaf entity. This covers the three named
-- concepts as configurations of one underlying platform rather than
-- inventing a rigid, over-specified hierarchy the brief didn't ask for.
-- ============================================================================

create type team_type as enum ('team', 'organization', 'clan');
create type team_member_role as enum ('owner', 'captain', 'member');
create type team_invitation_status as enum ('pending', 'accepted', 'declined', 'revoked');

create table teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  team_type team_type not null default 'team',
  parent_organization_id uuid references teams (id),
  owner_id uuid not null references profiles (id),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_teams_parent_not_self check (parent_organization_id is distinct from id)
);
comment on table teams is
  'Teams, organizations, and clans (Phase 8 TOURNAMENT-003) -- one entity, team_type discriminator. See migration header for why these are not three separate schemas.';

create index idx_teams_owner_id on teams (owner_id);
create index idx_teams_parent_organization_id on teams (parent_organization_id) where parent_organization_id is not null;
create index idx_teams_slug on teams (slug);

create trigger trg_teams_updated_at before update on teams
  for each row execute function fn_set_updated_at();

create table team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams (id) on delete cascade,
  user_id uuid not null references profiles (id),
  role team_member_role not null default 'member',
  joined_at timestamptz not null default now(),
  left_at timestamptz
);
comment on table team_members is
  'Team roster, including departed members (left_at set, not deleted) -- this IS "team history" for membership, the brief''s other named requirement, without a separate history table.';

-- Partial unique: a user can only hold one ACTIVE membership per team, but
-- can rejoin after leaving (a new row, not resurrecting the old one --
-- left_at on the prior row is never cleared, preserving genuine history).
create unique index uq_team_members_active on team_members (team_id, user_id) where left_at is null;
create index idx_team_members_user_id on team_members (user_id) where left_at is null;
create index idx_team_members_team_id on team_members (team_id) where left_at is null;

create table team_invitations (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams (id) on delete cascade,
  invited_user_id uuid not null references profiles (id),
  invited_by uuid not null references profiles (id),
  status team_invitation_status not null default 'pending',
  created_at timestamptz not null default now(),
  responded_at timestamptz
);
comment on table team_invitations is
  'Team invitations (Phase 8 TOURNAMENT-003). One pending invite per (team, user) at a time -- see the partial unique index below.';

create unique index uq_team_invitations_one_pending on team_invitations (team_id, invited_user_id) where status = 'pending';
create index idx_team_invitations_invited_user on team_invitations (invited_user_id, status);

-- Team tournament registration: nullable, additive column on the existing
-- tournament_registrations table (migration 0007) -- a registration is
-- either individual (team_id null, unchanged from today) or team-based
-- (team_id set, user_id is the registering captain/representative).
-- Never rebuilds tournament_registrations; extends it.
alter table tournament_registrations add column team_id uuid references teams (id);
create index idx_tournament_registrations_team_id on tournament_registrations (team_id) where team_id is not null;

-- Audit + notification category extensions (additive, matching existing
-- enum-extension conventions).
alter type audit_action_category add value if not exists 'team';
alter type notification_category add value if not exists 'team';

alter table teams enable row level security;
alter table teams force row level security;
alter table team_members enable row level security;
alter table team_members force row level security;
alter table team_invitations enable row level security;
alter table team_invitations force row level security;

-- Teams and rosters are public (matching v_leaderboard's existing public
-- posture, migration 0013) -- a team page is meant to be viewed by anyone,
-- the same way a player's profile stats are.
create policy teams_select_all on teams for select using (true);
create policy team_members_select_all on team_members for select using (true);

-- Invitations are private: only the invited user, the inviter, and staff
-- can see a pending invite -- it is not a public roster fact until accepted.
create policy team_invitations_select_own on team_invitations for select using (
  invited_user_id = auth.uid() or invited_by = auth.uid() or is_admin() or is_moderator()
);

-- No client INSERT/UPDATE/DELETE policies anywhere in this migration: all
-- writes go through the team-* Edge Functions (service_role), which
-- enforce ownership/captain authorization in application code the same
-- way every other write-through-Edge-Function table in this schema does
-- (e.g. wallets, tournaments).
