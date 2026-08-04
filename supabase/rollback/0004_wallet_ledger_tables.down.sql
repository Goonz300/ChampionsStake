-- Rollback 0004: Wallet & Ledger Tables
-- WARNING: this destroys financial history. Never run against a database
-- that has processed real transactions. Provided only for clean-environment
-- rollback during initial development.
drop table if exists wallet_ledger;
drop table if exists wallet_transactions;
drop table if exists wallets;
