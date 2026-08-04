-- Rollback 0037: Wallet Reconciliation Runs Table
drop policy if exists wallet_reconciliation_runs_select_staff on wallet_reconciliation_runs;
drop table if exists wallet_reconciliation_runs;
drop type if exists reconciliation_run_status;
