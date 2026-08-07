# Ledger Architecture

## 1. Double-Entry, Genuinely Enforced

`wallet_ledger` is a real double-entry ledger — every transaction's legs must net to zero across debits and credits. This is enforced at **two** independent layers:

1. **Application (fail-fast)**: `postBalancedEntries` (`_wallet/ledger.ts`) computes `netDebits`/`netCredits` and throws before ever opening a database transaction if they don't match.
2. **Database (authoritative)**: `trg_wallet_ledger_validate_balance`, a `DEFERRABLE INITIALLY DEFERRED` constraint trigger that re-sums every leg for a `wallet_transaction_id` at **commit time** and raises if unbalanced — this fires regardless of which code path produced the legs, closing any gap the application-layer check might miss.

## 2. Immutability

`wallet_ledger` rows are never updated or deleted (`trg_wallet_ledger_immutable`, unconditionally raises on `UPDATE`/`DELETE`). `wallet_transactions` rows are similarly protected once `status` reaches a terminal value (`completed`/`failed`/`reversed`) via `trg_wallet_transactions_no_mutation_after_terminal`, and can never be deleted at all (`trg_wallet_transactions_no_delete`).

## 3. Account Types

```
ledger_account_type: available | escrowed | pending | bonus | referral | platform_fee_revenue | platform_clearing
```

The first five are wallet-scoped (`wallet_id` required); the last two are singleton platform accounts (`wallet_id` must be null). This pairing is enforced by `chk_wallet_ledger_account_wallet_pairing`.

## 4. Reconciliation

`_wallet/reconciliation.ts`'s `runReconciliation` compares each wallet's cached `*_cents` columns against `fn_wallet_balance()` (a pure ledger-derived sum) for all five account types, freezing any mismatched wallet and recording a durable run in `wallet_reconciliation_runs`. Scheduled nightly via `pg_cron`; also callable on-demand (`wallet-reconciliation` Edge Function).

## 5. Phase 6 Fix: The CHECK Constraint Gap (Critical)

**This was the most severe defect this phase found.** `chk_wallet_ledger_account_wallet_pairing` (migration 0004, DB-001) originally allowed wallet-scoped legs only for `account_type in ('available', 'escrowed')` — correct at the time, since those were the only two wallet-scoped types that existed.

Migration 0035 (WALLET-001) later added `pending`, `bonus`, `referral` to the `ledger_account_type` enum, and migration 0036 correctly extended the cache-sync trigger (`fn_sync_wallet_cached_balance`) to project all five types into their columns. **No migration ever widened the CHECK constraint to match.**

Concrete effect, verified against the actual code before this fix (not assumed):
- `withdrawal-service.ts`'s `initiateWithdrawalHold`/`settleWithdrawal`/`reverseWithdrawalHold` all insert `account_type: 'pending'` legs — **every withdrawal was failing at INSERT time** against a real Postgres database.
- `transfer.ts`'s `platformToWallet` bonus-credit path inserts `account_type: 'bonus'` legs — **every bonus credit was failing** the same way.
- `referral` had no caller yet, but would have hit the identical wall the moment one was added.

**Fixed** (migration 0081): the constraint now permits `available | escrowed | pending | bonus | referral` for wallet-scoped legs, matching what the sync trigger has treated as valid since migration 0036. Purely additive — no existing row is affected, since no row using the newly-permitted combinations could have ever been successfully inserted before this migration.

This bug existed because **no test in this repository ever opens a live Postgres connection** to attempt the actual INSERT — every financial test is pure-logic-boundary testing (see `_wallet/ledger.test.ts`'s own header comment). The application-layer balance check passed; the database-layer constraint silently rejected the insert in a way no offline test could catch. This is a real, structural testing gap, not negligence — documented honestly in the [Reconciliation Guide](RECONCILIATION_GUIDE.md) and the [Operational Runbook](OPERATIONAL_RUNBOOK_PHASE6.md).

## 6. Idempotency (Three Coexisting Mechanisms — Documented, Not Unified)

1. **Generic**: `_shared/idempotency/index.ts`'s `idempotency_keys` table, used by `wallet-transfer`.
2. **Ledger-native**: `wallet_transactions.idempotency_key` has its own unique index (`uq_wallet_transactions_idempotency_key`) — used by `payment-initialize`, `payment-transfer`, `payment-verify`, `payment-refund`, and `wallet-adjustment` (which reuses the adjustment request's own UUID as the key).
3. **Provider-webhook**: `processed_payment_webhook_events`' unique `(provider, provider_event_id)` constraint.

All three genuinely work in isolation. Phase 6 did not unify them into one mechanism — each is correctly scoped to a different concern (generic request replay, ledger-write replay, provider webhook replay), and forcing a single pattern across all three would be exactly the kind of architecture rewrite this phase's brief forbids. Documented as accepted variance, not a defect.
