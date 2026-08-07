-- ============================================================================
-- Migration 0083: Withdrawal Risk Controls
--
-- Phase 6 audit finding (verified against the actual repository): no daily/
-- monthly withdrawal limit existed anywhere (only a per-transaction minimum,
-- WITHDRAWAL_MIN_CENTS), no manual-review queue existed for high-value
-- withdrawals, and requestWithdrawal called the payment provider's transfer
-- API immediately with no human-review gate of any kind.
--
-- Adds exactly one new payment_intent_status value -- 'pending_review' --
-- for a withdrawal that has already had its funds safely moved to the
-- wallet's `pending` sub-balance (initiateWithdrawalHold, unaffected by
-- this migration) but is held for administrator approval BEFORE the
-- provider transfer call is made, rather than after. This is additive to
-- the existing pending/completed/failed/expired lifecycle, not a
-- replacement of it -- most withdrawals (below the review threshold) are
-- entirely unaffected and continue straight to 'pending' as before.
-- ============================================================================

alter type payment_intent_status add value if not exists 'pending_review';
