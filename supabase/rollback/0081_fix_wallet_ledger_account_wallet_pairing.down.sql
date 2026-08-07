-- Rollback 0081: Fix wallet_ledger Account/Wallet Pairing Constraint
-- WARNING: rolling this back will re-break withdrawals and bonus credits
-- (restores the original DB-001 constraint that migration 0081 fixed).
-- Only roll back if reverting to a build that predates any pending/bonus/
-- referral wallet_ledger rows -- rows using those account types would
-- violate the restored, narrower constraint.
alter table wallet_ledger drop constraint chk_wallet_ledger_account_wallet_pairing;

alter table wallet_ledger add constraint chk_wallet_ledger_account_wallet_pairing check (
  (wallet_id is not null and account_type in ('available', 'escrowed'))
  or
  (wallet_id is null and account_type in ('platform_fee_revenue', 'platform_clearing'))
);
