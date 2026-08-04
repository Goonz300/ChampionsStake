-- ============================================================================
-- Migration 0059: Dispute Internal Notes & Queue View v2
--
-- SCOPE NOTE: "Moderators may create private notes. Players cannot view
-- them" -- nothing in DB-001 through ADMIN-001 has a home for this. New
-- table, RLS-gated to moderator/admin only (no participant-visibility
-- policy at all, unlike dispute_evidence/challenge_messages which
-- participants can see).
-- ============================================================================

create table dispute_notes (
  id uuid primary key default gen_random_uuid(),
  dispute_id uuid not null references disputes (id) on delete cascade,
  author_id uuid not null references profiles (id),
  content text not null,
  created_at timestamptz not null default now()
);
comment on table dispute_notes is
  'Private moderator-only notes on a dispute. Never visible to players -- no participant RLS policy exists on this table at all, by design.';

create index idx_dispute_notes_dispute_id on dispute_notes (dispute_id, created_at);

alter table dispute_notes enable row level security;
alter table dispute_notes force row level security;

create policy dispute_notes_select_staff on dispute_notes
  for select
  using (is_moderator());

create policy dispute_notes_insert_staff on dispute_notes
  for insert
  with check (is_moderator() and author_id = auth.uid());

-- No update/delete: notes are an append-only record of moderator reasoning,
-- consistent with every other audit-adjacent table in this schema.

-- Queue view v2: adds the priority column and the two new terminal states
-- to the existing v_moderator_queue (DB-001, migration 0013), and exposes
-- the "virtual state" columns described in migration 0058's header comment
-- so the moderator dashboard can render the full 10-state list without any
-- new enum fragmentation.
create or replace view v_moderator_queue
with (security_invoker = true) as
select
  d.id as dispute_id,
  d.challenge_id,
  d.status,
  d.priority,
  d.assigned_moderator_id,
  d.opened_by,
  d.evidence_deadline_at,
  d.created_at,
  d.appeal_filed_at,
  extract(epoch from (now() - d.created_at)) / 3600 as hours_open,
  case
    when d.status = 'open' and d.assigned_moderator_id is null then 'pending'
    when d.status = 'open' and d.assigned_moderator_id is not null and now() < d.evidence_deadline_at then 'awaiting_evidence'
    when d.status = 'open' and d.assigned_moderator_id is not null then 'assigned'
    when d.status = 'under_review' and now() < d.evidence_deadline_at then 'in_review'
    when d.status = 'under_review' then 'decision_ready'
    when d.status = 'resolved' then 'completed'
    when d.status = 'appealed' then 'appealed'
    when d.status = 'closed' then 'closed'
    else d.status::text
  end as display_state
from disputes d
where d.status in ('open', 'under_review', 'appealed')
order by d.priority desc, d.created_at asc;
comment on view v_moderator_queue is
  'Moderator dispute queue with a computed display_state covering all 10 states from this phase''s brief without fragmenting dispute_status (see migration 0058).';
