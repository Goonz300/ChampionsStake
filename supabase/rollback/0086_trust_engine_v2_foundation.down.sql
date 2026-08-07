-- Rollback 0086: Trust Engine v2 Foundation
drop table if exists chargebacks;
drop index if exists idx_trust_score_history_source_event;
alter table trust_score_history drop column if exists source_event_id;
