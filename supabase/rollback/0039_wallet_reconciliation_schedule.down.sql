-- Rollback 0039: Wallet Reconciliation Schedule
select cron.unschedule('wallet-reconciliation-daily');
