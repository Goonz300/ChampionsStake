# Accounting Design (ACID / Transaction Integrity)

## 1. Real Multi-Statement Transactions

`_shared/transactions/index.ts`'s `withTransaction` uses the `postgres` Deno driver against a **direct** Postgres connection (via Supavisor's transaction pooler) — not PostgREST, which cannot express a client-orchestrated multi-statement transaction. This is genuine `BEGIN`/`COMMIT`/`ROLLBACK`, not an approximation.

`postBalancedEntries` (`_wallet/ledger.ts`) wraps the entire unit of work — row locks, balance re-check, the `wallet_transactions` insert, and every `wallet_ledger` leg insert — inside **one** `withTransaction` call. If any step fails, everything rolls back; there is no partial-write state a concurrent reader could observe.

## 2. Deferred Constraint Enforcement

`trg_wallet_ledger_validate_balance` is `DEFERRABLE INITIALLY DEFERRED` — it doesn't check the balance invariant after each individual leg INSERT (which would fail on every multi-leg transaction, since legs are necessarily unbalanced until the last one lands), but at `COMMIT` time, once every leg for a `wallet_transaction_id` has been inserted. This is the one and only deferred constraint trigger in the schema, confirmed by grep before this phase.

## 3. Locking Discipline

Every wallet touched by a transfer is locked (`SELECT ... FOR UPDATE`) in **sorted wallet-id order**, specifically to prevent lock-ordering deadlocks — two concurrent transfers touching the same pair of wallets in opposite natural order would deadlock without this. Balance sufficiency is checked *after* the lock is held, not before, closing the check-then-act race a pre-lock check would leave open.

## 4. Idempotency at the Ledger Layer

`wallet_transactions.idempotency_key` has its own unique index — a retried request with the same key either replays the original result or is rejected as a conflict, never double-applied. See [LEDGER_ARCHITECTURE.md](LEDGER_ARCHITECTURE.md) §6 for the full picture of idempotency across this codebase (three coexisting, individually-correct mechanisms).

## 5. Phase 6's Contribution

Phase 6 did not change this transaction/locking model — it was already correct. Phase 6's fixes operate *within* this model:
- The CHECK constraint fix (BUG A) removed a case where the transaction would correctly roll back (Postgres rejecting an invalid INSERT is itself ACID-correct behavior) but the *business operation* (a withdrawal, a bonus credit) could never succeed at all.
- Tournament prize distribution (BUG C) is itself a single `postBalancedEntries` call — one atomic transaction covering every registrant's debit and every winner's credit, not a sequence of separate transfers that could partially fail leaving some players paid and others not.
- The manual-review withdrawal hold (Phase 6, withdrawal risk controls) does not introduce any new transaction risk: the hold (`initiateWithdrawalHold`) is a complete, committed transaction on its own, and the later approve/reject step is a *separate*, independently-atomic operation (either the provider transfer + status update, or the reversal + status update) — never a single transaction spanning both the hold and the eventual outcome, which is correct given the two events can be arbitrarily far apart in time (a human review step).

## 6. Known Boundary

No live Postgres connection exists in this sandboxed development environment. Every claim above about deadlock-freedom and deferred-constraint behavior under real concurrent load is verified by code review (the locking order, the trigger's `DEFERRABLE` declaration) — not by an executed concurrency test. See [WALLET_TESTS.md](../supabase/functions/_wallet/WALLET_TESTS.md) (pre-existing, WALLET-001) for the written-but-not-executed concurrency test plan this environment cannot run.
