-- Rollback 0019: RLS Policies — Wallet & Escrow
drop policy if exists escrow_transactions_select_staff on escrow_transactions;
drop policy if exists escrow_transactions_select_participant on escrow_transactions;
drop policy if exists escrow_accounts_select_staff on escrow_accounts;
drop policy if exists escrow_accounts_select_participant on escrow_accounts;
drop policy if exists wallet_ledger_select_staff on wallet_ledger;
drop policy if exists wallet_ledger_select_own on wallet_ledger;
drop policy if exists wallet_transactions_select_staff on wallet_transactions;
drop policy if exists wallet_transactions_select_own on wallet_transactions;
grant update (available_cents, escrowed_cents) on wallets to authenticated, anon;
drop policy if exists wallets_select_staff on wallets;
drop policy if exists wallets_select_own on wallets;
