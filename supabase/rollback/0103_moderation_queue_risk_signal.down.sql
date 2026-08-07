-- Rollback 0103: Moderation queue risk-signal join
-- Restores v_moderator_queue to its migration-0059 shape (no AI suggestion
-- columns, no secondary sort key).
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
