-- Rollback 0085: One Active Withdrawal Per Wallet (DB-Enforced)
drop index if exists uq_payment_intents_one_active_withdrawal_per_wallet;
