-- ============================================================================
-- Migration 0035: Wallet Engine Enum Extensions
--
-- SCOPE NOTE: this phase's brief lists transaction types (bonus_credit,
-- bonus_debit, tournament_entry, tournament_prize, chargeback) and
-- statuses (processing, cancelled, refunded, expired) beyond what DB-001
-- defined. Every one of these is additive to an existing enum, not a
-- redesign — "prize_payment" and "administrative_adjustment" from the brief
-- already map onto DB-001's existing 'payout' and 'adjustment' values, so
-- those are NOT duplicated here. Enum values can't be added and used in the
-- same transaction, hence this is its own migration file, separate from
-- 0036's table/column changes that actually use these new values.
-- ============================================================================

alter type transaction_type add value if not exists 'bonus_credit';
alter type transaction_type add value if not exists 'bonus_debit';
alter type transaction_type add value if not exists 'tournament_entry';
alter type transaction_type add value if not exists 'tournament_prize';
alter type transaction_type add value if not exists 'chargeback';

alter type transaction_status add value if not exists 'processing';
alter type transaction_status add value if not exists 'cancelled';
alter type transaction_status add value if not exists 'refunded';
alter type transaction_status add value if not exists 'expired';

-- Three new ledger account types, so the wallet engine can track pending
-- (in-flight, not-yet-settled), bonus (promotional credit), and referral
-- balances as genuine ledger-derived sub-balances, the same way
-- available/escrowed already work (DB-001 migration 0004) — never as a
-- bare mutable column.
alter type ledger_account_type add value if not exists 'pending';
alter type ledger_account_type add value if not exists 'bonus';
alter type ledger_account_type add value if not exists 'referral';
