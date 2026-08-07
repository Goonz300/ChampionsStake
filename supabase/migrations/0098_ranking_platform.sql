-- ============================================================================
-- Migration 0098: Ranking Platform (Phase 8 TOURNAMENT-006)
--
-- Trust != Skill (explicit instruction): profiles.trust_score (Trust
-- Engine v2, migration 0086) and _ai/elo.ts's Elo math measure fraud/
-- behavior risk from match outcomes -- this is a COMPLETELY SEPARATE
-- storage location and concept for competitive SKILL. Nothing here reads
-- or writes trust_score; nothing in Trust Engine v2 reads or writes this.
-- The underlying Elo FORMULA (expectedScore/computeEloUpdate in
-- _ai/elo.ts) is reused as pure math where this system also offers an Elo
-- mode -- reusing a mathematical formula is not the same as coupling the
-- two CONCEPTS, which remain fully independent (separate table, separate
-- history, separate computation entry point).
--
-- Glicko-1 (not Glicko-2): Glicko-2 adds a volatility parameter with an
-- iterative convergence step (the "Illinois algorithm") that's genuinely
-- complex to implement correctly without reference test vectors this
-- environment can verify against. Glicko-1 (rating + rating deviation,
-- Mark Glickman's original 1995 system) is a complete, real, well-defined
-- rating system in its own right -- not a "Glicko-lite" stand-in -- and
-- is what's implemented. Documented, not silently downgraded.
--
-- Scope: one rating per (user, game, scope). "Tournament Rating"/"Regional
-- Rating"/"Season Rating"/"Global Rating" are the same underlying concept
-- at different scopes, not four separate systems -- scope_type +
-- scope_id (nullable, holds a region code / season id / tournament id as
-- text depending on scope_type) covers all four without four tables.
-- ============================================================================

create type rating_system as enum ('elo', 'glicko');
create type rating_scope_type as enum ('global', 'regional', 'season', 'tournament');

create table player_ratings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id),
  game_id uuid not null references games (id),
  scope_type rating_scope_type not null default 'global',
  scope_id text, -- region code, season id, or tournament id depending on scope_type; null for 'global'
  rating_system rating_system not null default 'glicko',
  rating numeric not null default 1500,
  glicko_rd numeric not null default 350, -- rating deviation; null-equivalent unused for elo mode, kept populated for a possible future mode switch
  glicko_volatility numeric not null default 0.06,
  matches_played integer not null default 0,
  last_match_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_player_ratings_scope check (
    (scope_type = 'global' and scope_id is null) or
    (scope_type != 'global' and scope_id is not null)
  )
);
comment on table player_ratings is
  'Competitive skill rating (Phase 8 TOURNAMENT-006) -- distinct from profiles.trust_score, never conflated. One row per (user, game, scope).';

create unique index uq_player_ratings_scope on player_ratings (
  user_id, game_id, scope_type, coalesce(scope_id, '')
);
create index idx_player_ratings_leaderboard on player_ratings (
  game_id, scope_type, coalesce(scope_id, ''), rating desc
);

create trigger trg_player_ratings_updated_at before update on player_ratings
  for each row execute function fn_set_updated_at();

create table rating_history (
  id uuid primary key default gen_random_uuid(),
  player_rating_id uuid not null references player_ratings (id) on delete cascade,
  user_id uuid not null references profiles (id), -- denormalized from player_ratings.user_id so idempotency/history queries never need to join through player_ratings
  old_rating numeric not null,
  new_rating numeric not null,
  delta numeric not null,
  old_rd numeric,
  new_rd numeric,
  opponent_id uuid references profiles (id),
  challenge_id uuid references challenges (id),
  reason text not null,
  created_at timestamptz not null default now()
);
comment on table rating_history is
  'Explainable, reproducible log of every rating adjustment -- same pattern as trust_score_history (migration 0060).';

create index idx_rating_history_player_rating_id on rating_history (player_rating_id, created_at desc);
create index idx_rating_history_challenge_user on rating_history (challenge_id, user_id) where challenge_id is not null;

alter table player_ratings enable row level security;
alter table player_ratings force row level security;
alter table rating_history enable row level security;
alter table rating_history force row level security;

-- Public, same posture as reputation_scores/teams/leagues -- a leaderboard
-- is meant to be viewed by anyone.
create policy player_ratings_select_all on player_ratings for select using (true);
create policy rating_history_select_all on rating_history for select using (true);
-- No client writes: only the ranking-engine Edge Function (service_role) writes here.
