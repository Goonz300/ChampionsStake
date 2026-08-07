-- ============================================================================
-- Migration 0089: Reputation Engine (Phase 7 AI-004)
--
-- Reputation is a distinct axis from trust_score: trust (Trust Engine v2,
-- migration 0086) measures fraud/behavior RISK (disputes lost, chargebacks,
-- sanctions hits); reputation measures QUALITY/STANDING (consistency,
-- tournament performance, organizer/moderator track record) -- a player can
-- have high trust (never disputed, never flagged) while being a mediocre
-- competitor, or vice versa. Kept as a separate table rather than folded
-- into trust_score for exactly that reason.
--
-- Subject types: player, moderator, tournament, organizer, team. "Global"
-- reputation is not a separate subject type -- it IS a player's reputation
-- row (the platform-wide figure IS the per-player figure; a separate
-- "global" row would just duplicate it). "Historical" reputation is
-- reputation_history below, not a subject type. "Team" is included in the
-- enum now even though Phase 8 M2 (Team Platform) hasn't been built yet in
-- this migration sequence -- additive schema now avoids a second migration
-- later purely to widen an enum, and computing team reputation is simply
-- unreachable code until team rows exist, not a broken feature.
-- ============================================================================

create type reputation_subject_type as enum (
  'player', 'moderator', 'tournament', 'organizer', 'team'
);

create table reputation_scores (
  id uuid primary key default gen_random_uuid(),
  subject_type reputation_subject_type not null,
  subject_id uuid not null,
  score numeric not null check (score >= 0 and score <= 100),
  factors jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null default now()
);
comment on table reputation_scores is
  'Current, explainable reputation score per subject (Phase 7 AI-004). Distinct from trust_score -- see migration header.';

create unique index uq_reputation_scores_subject on reputation_scores (subject_type, subject_id);
create index idx_reputation_scores_type_score on reputation_scores (subject_type, score desc);

create table reputation_history (
  id uuid primary key default gen_random_uuid(),
  subject_type reputation_subject_type not null,
  subject_id uuid not null,
  old_score numeric,
  new_score numeric not null,
  factors jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null default now()
);
comment on table reputation_history is
  'Append-only history of reputation_scores changes (the "historical reputation" the Phase 7 brief names) -- same explainability pattern as trust_score_history.';

create index idx_reputation_history_subject on reputation_history (subject_type, subject_id, computed_at desc);

alter table reputation_scores enable row level security;
alter table reputation_scores force row level security;
alter table reputation_history enable row level security;
alter table reputation_history force row level security;

-- Reputation is not sensitive the way trust_score's fraud-risk factors are
-- (Business Rules never restricted reputation-style stats -- completion
-- rate/win rate are already public via v_leaderboard, migration 0013) --
-- readable by anyone, matching that precedent, not staff-only like
-- risk_scores/trust_score_history.
create policy reputation_scores_select_all on reputation_scores for select using (true);
create policy reputation_history_select_all on reputation_history for select using (true);
-- No client writes: only the ai-reputation-engine Edge Function (service_role) writes here.
