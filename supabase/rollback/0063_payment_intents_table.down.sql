-- Rollback 0063: Payment Intents Table
drop policy if exists payment_intents_select_staff on payment_intents;
drop policy if exists payment_intents_select_own on payment_intents;
drop trigger if exists trg_payment_intents_updated_at on payment_intents;
drop table if exists payment_intents;
drop type if exists payment_intent_kind;
drop type if exists payment_intent_status;
