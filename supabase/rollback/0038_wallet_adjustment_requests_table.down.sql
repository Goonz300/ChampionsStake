-- Rollback 0038: Wallet Adjustment Requests Table
drop policy if exists wallet_adjustment_requests_select_admin on wallet_adjustment_requests;
drop table if exists wallet_adjustment_requests;
drop type if exists wallet_adjustment_status;
