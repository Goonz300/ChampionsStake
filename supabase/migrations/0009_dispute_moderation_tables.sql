-- ============================================================================
-- Migration 0009: Dispute & Moderation Tables
-- Tables: disputes, dispute_evidence, moderator_actions
-- ============================================================================

create table disputes (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null unique references challenges (id) on delete restrict,
  opened_by uuid not null references profiles (id),
  reason text not null,
  status dispute_status not null default 'open',
  assigned_moderator_id uuid references profiles (id),
  resolution dispute_resolution,
  resolution_rationale text, -- mandatory at decision time, enforced by trigger (migration 0012)
  evidence_deadline_at timestamptz not null default (now() + interval '48 hours'),
  decided_at timestamptz,
  appeal_filed_at timestamptz,
  appeal_deadline_at timestamptz,
  appeal_decided_at timestamptz,
  appeal_decided_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table disputes is
  'One dispute per challenge (Business Rules §9). Resolution requires a mandatory written rationale.';

create index idx_disputes_status on disputes (status);
create index idx_disputes_assigned_moderator_id on disputes (assigned_moderator_id) where status in ('open', 'under_review');
create index idx_disputes_evidence_deadline on disputes (evidence_deadline_at) where status = 'open';

-- dispute_evidence ----------------------------------------------------------
-- Immutable — proof submissions are never edited or deleted once submitted
-- (enforced in migration 0012).
create table dispute_evidence (
  id uuid primary key default gen_random_uuid(),
  dispute_id uuid not null references disputes (id) on delete cascade,
  submitted_by uuid not null references profiles (id),
  evidence_type evidence_type not null,
  storage_path text not null,
  note text,
  created_at timestamptz not null default now()
);
comment on table dispute_evidence is
  'Immutable proof submissions for a dispute (Business Rules §9). Stored in the proofs bucket.';

create index idx_dispute_evidence_dispute_id on dispute_evidence (dispute_id);

-- moderator_actions -----------------------------------------------------
-- Immutable log of every moderator/admin decision with mandatory rationale
-- (Business Rules §10/§11). Distinct from audit_logs, which is the
-- system-wide event log; this table is specifically the decision record
-- moderators/admins are accountable against.
create table moderator_actions (
  id uuid primary key default gen_random_uuid(),
  moderator_id uuid not null references profiles (id),
  action_type text not null,
  target_table text not null,
  target_id uuid not null,
  dispute_id uuid references disputes (id),
  challenge_id uuid references challenges (id),
  rationale text not null,
  created_at timestamptz not null default now(),
  constraint chk_moderator_actions_rationale_present check (char_length(rationale) >= 10)
);
comment on table moderator_actions is
  'Immutable log of moderator/admin decisions with mandatory rationale (Business Rules §10/§11).';

create index idx_moderator_actions_moderator_id on moderator_actions (moderator_id);
create index idx_moderator_actions_dispute_id on moderator_actions (dispute_id) where dispute_id is not null;
