-- Rollback 0062: Payment Webhook Idempotency & Payout Methods
drop policy if exists payout_methods_select_staff on payout_methods;
drop policy if exists payout_methods_select_own on payout_methods;
drop table if exists payout_methods;
drop policy if exists processed_payment_webhook_events_select_admin on processed_payment_webhook_events;
drop table if exists processed_payment_webhook_events;
