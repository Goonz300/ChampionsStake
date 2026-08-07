-- ============================================================================
-- Migration 0095: League & Season Platform (Phase 8 TOURNAMENT-004)
--
-- Both League (M3) and Season (M4) schema land in one migration: a season
-- is a time-boxed period WITHIN a league (divisions are the league's
-- permanent structure; a season's standings determine promotion/relegation
-- INTO the next season's division assignment) -- the two concepts can't be
-- split across migrations without one referencing a table that doesn't
-- exist yet. M3's own deliverable is leagues/divisions/promotion-relegation
-- and season INTEGRATION (querying/linking to seasons); M4's deliverable is
-- the season LIFECYCLE workflow (start/end/archive/rewards/rollover) built
-- as application code on top of this schema, not a second migration.
--
-- Reuses regions (migration 0006) for leagues.region_code rather than a
-- new lookup table -- the same regions Matchmaking Intelligence (Phase 7
-- M4) and Regional Ranking (Phase 8 M5) already use.
--
-- Participants: a league standing belongs to either an individual player OR
-- a team (Phase 8 M2), matching tournament_registrations' own
-- individual-or-team pattern (migration 0094's team_id) rather than forcing
-- every league to be one or the other.
-- ============================================================================

create type league_status as enum ('active', 'archived');
create type season_status as enum ('upcoming', 'active', 'completed', 'archived');

create table leagues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  game_id uuid not null references games (id),
  region_code text references regions (code),
  status league_status not null default 'active',
  created_by uuid not null references profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table leagues is 'Persistent league (Phase 8 TOURNAMENT-004) -- spans multiple seasons over time.';

create index idx_leagues_game_id on leagues (game_id);
create index idx_leagues_status on leagues (status);

create trigger trg_leagues_updated_at before update on leagues
  for each row execute function fn_set_updated_at();

create table divisions (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues (id) on delete cascade,
  name text not null,
  tier integer not null check (tier > 0), -- 1 = top division
  created_at timestamptz not null default now(),
  unique (league_id, tier)
);
comment on table divisions is 'A league''s permanent tier structure (e.g. Premier/Championship/League One). Team/player division ASSIGNMENT is per-season (season_participants below), since promotion/relegation moves participants between divisions each season.';

create index idx_divisions_league_id on divisions (league_id);

create table seasons (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues (id) on delete cascade,
  name text not null,
  status season_status not null default 'upcoming',
  starts_at timestamptz,
  ends_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table seasons is 'A time-boxed period within a league. Season lifecycle (start/end/archive) is Phase 8 M4''s application-code workflow, operating on this status column.';

create index idx_seasons_league_id_status on seasons (league_id, status);

create trigger trg_seasons_updated_at before update on seasons
  for each row execute function fn_set_updated_at();

create table season_participants (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references seasons (id) on delete cascade,
  division_id uuid not null references divisions (id),
  user_id uuid references profiles (id),
  team_id uuid references teams (id),
  wins integer not null default 0,
  losses integer not null default 0,
  draws integer not null default 0,
  points integer not null default 0,
  created_at timestamptz not null default now(),
  constraint chk_season_participants_one_entity check (
    (user_id is not null and team_id is null) or
    (user_id is null and team_id is not null)
  )
);
comment on table season_participants is 'A player or team''s division assignment and running record for one season -- this IS "season standings" (the brief''s other named requirement), queried directly, not a separate table.';

create unique index uq_season_participants_user on season_participants (season_id, user_id) where user_id is not null;
create unique index uq_season_participants_team on season_participants (season_id, team_id) where team_id is not null;
create index idx_season_participants_division on season_participants (division_id, points desc);

alter table leagues enable row level security;
alter table leagues force row level security;
alter table divisions enable row level security;
alter table divisions force row level security;
alter table seasons enable row level security;
alter table seasons force row level security;
alter table season_participants enable row level security;
alter table season_participants force row level security;

-- Public read, same posture as teams/tournaments/v_leaderboard -- a league
-- table is meant to be viewed by anyone.
create policy leagues_select_all on leagues for select using (true);
create policy divisions_select_all on divisions for select using (true);
create policy seasons_select_all on seasons for select using (true);
create policy season_participants_select_all on season_participants for select using (true);
-- No client writes: only the league-manage Edge Function (service_role) writes here.
