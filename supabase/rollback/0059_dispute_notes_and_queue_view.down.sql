-- Rollback 0059: Dispute Internal Notes & Queue View v2
create or replace view v_moderator_queue
with (security_invoker = true) as
select
  d.id as dispute_id,
  d.challenge_id,
  d.status,
  d.assigned_moderator_id,
  d.opened_by,
  d.evidence_deadline_at,
  d.created_at,
  extract(epoch from (now() - d.created_at)) / 3600 as hours_open
from disputes d
where d.status in ('open', 'under_review')
order by d.created_at asc;

drop policy if exists dispute_notes_insert_staff on dispute_notes;
drop policy if exists dispute_notes_select_staff on dispute_notes;
drop table if exists dispute_notes;
