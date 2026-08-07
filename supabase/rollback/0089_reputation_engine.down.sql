-- Rollback 0089: Reputation Engine
drop table if exists reputation_history;
drop table if exists reputation_scores;
drop type if exists reputation_subject_type;
