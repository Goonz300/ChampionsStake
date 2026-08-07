-- ============================================================================
-- Migration 0091: AI Moderation Assistant (Phase 7 AI-006)
--
-- Migration 0058 explicitly declined to build "a separate priority-scoring
-- engine" -- but that decision was scoped to ITS OWN phase's mandate
-- ("orchestrate existing services only"). Phase 7's brief explicitly asks
-- for an AI Moderation Assistant that prioritizes cases, clusters
-- duplicates, suggests actions, and estimates confidence -- squarely this
-- phase's job, not a contradiction of 0058's decision.
--
-- Critically, this stays ASSISTIVE, never authoritative: disputes.priority
-- (0058) is untouched by anything in this migration or the code that reads
-- it -- a moderator's manual priority setting is never overwritten by a
-- suggestion. moderation_case_suggestions is a SEPARATE, parallel table a
-- moderator can choose to look at, exactly the brief's "assist, never
-- replace" instruction in concrete schema form.
-- ============================================================================

create table moderation_case_suggestions (
  id uuid primary key default gen_random_uuid(),
  dispute_id uuid not null unique references disputes (id) on delete cascade,
  suggested_priority dispute_priority not null,
  cluster_id uuid,
  suggested_action text not null,
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  factors jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now()
);
comment on table moderation_case_suggestions is
  'AI Moderation Assistant output (Phase 7 AI-006) -- suggestions only, never written back to disputes.priority or any dispute-lifecycle column. A moderator reads this table entirely at their own discretion.';

create index idx_moderation_case_suggestions_cluster on moderation_case_suggestions (cluster_id) where cluster_id is not null;
create index idx_moderation_case_suggestions_priority on moderation_case_suggestions (suggested_priority desc, generated_at desc);

alter table moderation_case_suggestions enable row level security;
alter table moderation_case_suggestions force row level security;

create policy moderation_case_suggestions_select_staff on moderation_case_suggestions for select using (is_admin() or is_moderator());
-- No client writes: only the ai-moderation-assistant Edge Function (service_role) writes here.
