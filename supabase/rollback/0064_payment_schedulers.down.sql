-- Rollback 0064: Payment Reconciliation Scheduler
select cron.unschedule('payment-reconciliation-every-15-minutes');
