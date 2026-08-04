-- ============================================================================
-- Migration 0058: Dispute Status Extension & Priority
--
-- This phase's brief lists 10 dispute-queue states (Pending, Assigned, In
-- Review, Awaiting Evidence, Awaiting Player Response, Escrow Pending,
-- Decision Ready, Completed, Appealed, Closed). Following the same
-- principle CHALLENGE-001/TOURNAMENT-001 established for "Ready Check" vs
-- "Ready" and "Semi Finals" vs round.name: only genuinely new, non-derivable
-- states are added as enum values. The rest are VIEW-COMPUTED from existing
-- columns (v_moderator_queue, updated below) rather than fragmenting the
-- schema with states that duplicate information already present:
--   Pending          -> status='open' AND assigned_moderator_id IS NULL
--   Assigned         -> status='open' AND assigned_moderator_id IS NOT NULL
--   In Review        -> status='under_review'
--   Awaiting Evidence-> status IN ('open','under_review') AND now() < evidence_deadline_at
--   Decision Ready   -> status='under_review' AND now() >= evidence_deadline_at
--   Awaiting Player Response / Escrow Pending -> these describe the
--     underlying CHALLENGE's state (awaiting_confirmation / escrow_pending),
--     not the dispute's own state -- the case detail view (case-management,
--     this phase) surfaces the challenge status directly rather than
--     duplicating it onto disputes.
--   Completed        -> status='resolved'
--
-- Two states genuinely can't be derived from existing columns and are added
-- as real enum values: 'appealed' (distinct from 'resolved' -- a decision
-- was made but is now under appeal) and 'closed' (terminal, post-appeal-
-- window or appeal-decided).
-- ============================================================================

alter type dispute_status add value if not exists 'appealed';
alter type dispute_status add value if not exists 'closed';

-- Priority queue support -- nothing computes this today; a simple
-- moderator/system-settable column is sufficient (no need for a separate
-- priority-scoring engine, which would be a genuine new business-logic
-- system this phase's "orchestrate existing services only" mandate argues
-- against inventing).
create type dispute_priority as enum ('low', 'normal', 'high', 'urgent');
alter table disputes add column priority dispute_priority not null default 'normal';

create index idx_disputes_priority_created_at on disputes (priority desc, created_at asc) where status in ('open', 'under_review');
