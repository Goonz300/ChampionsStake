-- ============================================================================
-- Migration 0060: Fraud Flags & Trust Score History
--
-- SCOPE NOTE: the API Specification's ADMIN-EP-07 ("Fraud Flag Queue") has
-- referenced a fraud-flags concept since that document was written, but no
-- table was ever created for it — this phase (AI-001) is the first to
-- actually need it. Business Rules §14/§17: flags are for MODERATOR REVIEW
-- only; nothing in this schema or the functions built on it ever
-- auto-blocks funds — that would contradict "never auto-block funds
-- without human review in v1."
--
-- trust_score_history is added because Business Rules §13 requires trust
-- score to be "explainable" and "reproducible" — a bare current value on
-- profiles.trust_score can't show a user (or a moderator investigating a
-- dispute) WHY it changed. Every adjustment is logged here with the inputs
-- that produced it.
-- ============================================================================

create type fraud_flag_type as enum ('collusion', 'multi_account', 'suspicious_withdrawal', 'suspicious_deposit', 'repeated_opponent');
create type fraud_flag_status as enum ('open', 'reviewed_cleared', 'reviewed_confirmed');

create table fraud_flags (
  id uuid primary key default gen_random_uuid(),
  flag_type fraud_flag_type not null,
  primary_user_id uuid not null references profiles (id),
  secondary_user_id uuid references profiles (id), -- the other party, for collusion/repeated-opponent flags
  challenge_id uuid references challenges (id),
  score numeric not null, -- 0-100, higher = more suspicious
  details jsonb not null default '{}'::jsonb,
  status fraud_flag_status not null default 'open',
  reviewed_by uuid references profiles (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
comment on table fraud_flags is
  'Automated fraud signals for moderator/admin review (Business Rules §14). Never auto-blocks funds — flag only, per this phase''s explicit scope.';

create index idx_fraud_flags_status_score on fraud_flags (status, score desc) where status = 'open';
create index idx_fraud_flags_primary_user on fraud_flags (primary_user_id);

alter table fraud_flags enable row level security;
alter table fraud_flags force row level security;

create policy fraud_flags_select_staff on fraud_flags for select using (is_admin() or is_moderator());
create policy fraud_flags_update_staff on fraud_flags for update using (is_admin() or is_moderator()) with check (is_admin() or is_moderator());
-- No client insert: only the ai-fraud-scan Edge Function (service_role) writes here.

-- trust_score_history --------------------------------------------------
create table trust_score_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id),
  challenge_id uuid references challenges (id),
  old_score numeric not null,
  new_score numeric not null,
  delta numeric not null,
  reason text not null, -- e.g. 'match_win', 'match_loss', 'dispute_loss'
  k_factor numeric not null,
  opponent_score_at_time numeric,
  created_at timestamptz not null default now()
);
comment on table trust_score_history is
  'Explainable, reproducible log of every trust_score adjustment (Business Rules §13 — "deterministic formula... reproducible explanation").';

create index idx_trust_score_history_user_id on trust_score_history (user_id, created_at desc);

alter table trust_score_history enable row level security;
alter table trust_score_history force row level security;

create policy trust_score_history_select_own on trust_score_history for select using (user_id = auth.uid());
create policy trust_score_history_select_staff on trust_score_history for select using (is_admin() or is_moderator());
-- No client writes: only ai-trust-score (service_role) writes here.
