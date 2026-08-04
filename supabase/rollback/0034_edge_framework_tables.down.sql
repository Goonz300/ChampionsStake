-- Rollback 0034: Edge Function Framework Support Tables
drop table if exists domain_events;
drop table if exists idempotency_keys;
drop type if exists idempotency_status;
