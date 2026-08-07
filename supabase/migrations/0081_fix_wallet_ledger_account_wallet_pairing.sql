-- ============================================================================
-- Migration 0081: Fix wallet_ledger Account/Wallet Pairing Constraint
--
-- Phase 6 (Wallet, Ledger, Escrow & Financial Platform) audit, verified
-- against the actual repository before writing this (this session's own
-- audit-first rule) -- a genuine, narrowly-scoped bug, not a redesign.
--
-- migration 0004 (DB-001) defined chk_wallet_ledger_account_wallet_pairing
-- allowing wallet_id is not null only paired with account_type in
-- ('available', 'escrowed') -- correct at the time, since those were the
-- only two wallet-scoped account types that existed.
--
-- migration 0035 (WALLET-001) later added 'pending', 'bonus', 'referral' to
-- the ledger_account_type enum, and migration 0036 correctly extended
-- fn_sync_wallet_cached_balance to project all five wallet-scoped types
-- into their cached wallets.*_cents columns -- but NO migration ever
-- widened this CHECK constraint to match. The result: every wallet_ledger
-- insert using account_type='pending' (withdrawal-service.ts's
-- initiateWithdrawalHold/settleWithdrawal/reverseWithdrawalHold,
-- _wallet/transfer.ts) or account_type='bonus' (platformToWallet's
-- bonus_credit path) is rejected by Postgres at INSERT time with a check
-- constraint violation -- meaning every withdrawal and every bonus credit
-- fails against a real database today. 'referral' has no caller yet but
-- would hit the identical wall the moment one is added.
--
-- Fix: widen the constraint to match what 0036's own trigger logic already
-- treats as valid wallet-scoped account types. Purely additive (a wider
-- CHECK, not a schema redesign) -- no existing row is affected since no
-- 'pending'/'bonus'/'referral' wallet_ledger row could have ever been
-- successfully inserted before this migration.
-- ============================================================================

alter table wallet_ledger drop constraint chk_wallet_ledger_account_wallet_pairing;

alter table wallet_ledger add constraint chk_wallet_ledger_account_wallet_pairing check (
  (wallet_id is not null and account_type in ('available', 'escrowed', 'pending', 'bonus', 'referral'))
  or
  (wallet_id is null and account_type in ('platform_fee_revenue', 'platform_clearing'))
);
