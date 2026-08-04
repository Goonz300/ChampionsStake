-- Rollback 0058: Dispute Status Extension & Priority
drop index if exists idx_disputes_priority_created_at;
alter table disputes drop column if exists priority;
drop type if exists dispute_priority;
-- dispute_status enum values ('appealed', 'closed') cannot be cleanly
-- removed -- see 0015's rollback note for the general PostgreSQL limitation.
