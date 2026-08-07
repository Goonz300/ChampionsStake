-- 0103_moderation_queue_risk_signal.sql
--
-- Cross-system integration audit finding: the AI Moderation Assistant
-- (migration 0091, _ai/moderation-assistant.ts) computes a risk-informed
-- suggested_priority per dispute into moderation_case_suggestions, but
-- v_moderator_queue (migration 0059) never joined to it -- a moderator
-- working the queue in priority order had zero visibility into the risk
-- signal unless they happened to open that exact case individually.
--
-- Fix, staying inside the documented "assistive only" boundary
-- (moderation-assistant.ts's own header: "never writes disputes.priority
-- or any other dispute-lifecycle column"): expose the suggestion columns
-- on the queue view, and use suggested_priority only as a SECONDARY sort
-- key, breaking ties within a given human-set disputes.priority tier.
-- disputes.priority (set only by a moderator, via _moderator/queue.ts's
-- setPriority) remains the sole primary sort key and is never overridden
-- by the AI signal -- this prevents a party from gaming their own risk
-- score to bump or bury a case a moderator has already explicitly triaged,
-- while still surfacing risk for the common case (default 'normal'
-- priority, never manually touched).

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
  end as display_state,
  mcs.suggested_priority as ai_suggested_priority,
  mcs.suggested_action as ai_suggested_action,
  mcs.confidence as ai_confidence,
  mcs.cluster_id as ai_cluster_id
from disputes d
left join moderation_case_suggestions mcs on mcs.dispute_id = d.id
where d.status in ('open', 'under_review', 'appealed')
order by d.priority desc, mcs.suggested_priority desc nulls last, d.created_at asc;

comment on view v_moderator_queue is
  'Moderator dispute queue with a computed display_state (migration 0058) and, as of Phase 7 cross-system integration, the AI Moderation Assistant''s risk-informed suggestion joined in for display and as a same-tier tie-break -- disputes.priority (human-set) remains the sole primary sort key.';
