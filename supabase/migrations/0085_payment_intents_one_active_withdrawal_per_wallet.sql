-- ============================================================================
-- Migration 0085: One Active Withdrawal Per Wallet (DB-Enforced)
--
-- Phase 6 hostile-review finding: requestWithdrawal's "you already have a
-- withdrawal in progress" check (_payment/withdrawal-service.ts) was an
-- application-level SELECT with no database-level backstop --
-- payment_intents had no unique constraint preventing two concurrent
-- requests from both passing that SELECT before either INSERT lands
-- (confirmed by reading migration 0063: only uq_payment_intents_provider_ref
-- exists, which doesn't apply here since neither concurrent request has a
-- provider_ref yet). Two simultaneous withdrawal requests for the same
-- wallet, both racing the same narrow window, could both proceed to call
-- the payment provider -- sending real money out twice.
--
-- This partial unique index makes "at most one active (pending or
-- pending_review) withdrawal per wallet" a real database guarantee, not
-- just an application-level check that can race. withdrawal-service.ts is
-- updated in the same phase to insert the payment_intents row (and hit
-- this constraint, if it's going to) BEFORE calling the payment provider,
-- not after -- so a losing concurrent request fails before any money
-- actually leaves the platform, not after.
-- ============================================================================

create unique index uq_payment_intents_one_active_withdrawal_per_wallet
  on payment_intents (wallet_id)
  where kind = 'withdrawal' and status in ('pending', 'pending_review');
