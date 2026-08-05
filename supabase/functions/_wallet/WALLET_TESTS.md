# Wallet Engine — Integration, Concurrency, and Load Test Plan

`ledger.test.ts` covers the one piece of `postBalancedEntries` that's pure logic
(the debit/credit balance check, which runs before any DB connection opens).
Everything below needs a live Postgres instance — this container has neither
Deno nor network access (same confirmed limitation as every prior phase), so
these are specified precisely enough to implement directly, not implemented
here.

## Ledger tests

1. **Balanced 2-wallet transfer succeeds**: `walletToWallet` between two seeded
   wallets with sufficient funds; assert both wallets' cached balances match
   `fn_wallet_balance` afterward.
2. **Insufficient funds is rejected**: attempt a debit leg larger than the
   wallet's current ledger-derived balance; assert `ConflictError` and that NO
   rows were written to `wallet_transactions`/`wallet_ledger` (the transaction
   rolled back cleanly).
3. **The deferred constraint trigger actually fires**: attempt to insert an
   unbalanced `wallet_ledger` pair directly via raw SQL (bypassing `ledger.ts`
   entirely) and confirm the transaction is rejected at COMMIT by DB-001's
   `fn_validate_ledger_balance` — this is the test that proves the database
   itself enforces the invariant, not just the TypeScript layer.

## Concurrency tests

4. **Double-spend race**: fire two concurrent `walletToWallet` debits from the
   same wallet, each individually valid but which together exceed the balance.
   Assert exactly one succeeds and one fails with `ConflictError` — this is what
   the `SELECT ... FOR UPDATE` row lock in `ledger.ts` exists to guarantee.
5. **Lock-ordering deadlock avoidance**: fire two concurrent transfers between
   the same two wallets in opposite directions (A→B and B→A simultaneously).
   Assert both complete successfully with no deadlock — this is what the
   sorted-wallet-ID locking order in `ledger.ts` exists to prevent.
6. **Duplicate idempotency key with the same payload**: call `wallet-transfer`
   twice with an identical body and `Idempotency-Key`. Assert the second call
   returns the exact same `transaction_id` and does NOT create a second
   `wallet_transactions` row.
7. **Duplicate idempotency key with a different payload**: same key, different
   `amountCents`. Assert `IdempotencyConflictError` (409).

## Transaction rollback tests

8. **Mid-transfer failure rolls back cleanly**: inject a failure after the
   `wallet_transactions` insert but before all `wallet_ledger` legs are written
   (e.g. a simulated connection drop) — assert neither the transaction row nor
   any partial ledger legs persist. This is the concrete test for
   `withTransaction`'s rollback-on-throw guarantee from EDGE-001.

## Idempotency tests (wallet-adjustment specifically)

9. **Same admin cannot approve their own proposal**: propose an adjustment as
   admin A, attempt to approve as admin A — assert `ValidationError` (the
   four-eyes check), and assert no ledger entries were written.
10. **Expired proposal cannot be approved**: manually backdate a
    `wallet_adjustment_requests.expires_at` to the past, attempt approval —
    assert `ConflictError` and that the row's status flips to `expired`.

## Balance verification / reconciliation tests

11. **Reconciliation detects a manually-introduced drift**: directly
    `UPDATE wallets SET available_cents = available_cents + 100` via raw SQL
    (bypassing the guard trigger — possible only as a superuser in a test
    harness, simulating "what if the guard somehow failed"), run
    `runReconciliation`, and assert the wallet is frozen and the drift appears
    in `wallet_reconciliation_runs.details`.
12. **Clean reconciliation run finds zero mismatches**: run reconciliation
    against a set of wallets with no manual tampering, assert
    `mismatches_found = 0` and no wallet is frozen.

## Load / stress tests

13. **100,000 wallets, paginated reconciliation**: seed 100,000 wallet rows
    (script, not part of CI) and confirm `runReconciliation` completes within a
    defined SLA using `listWalletsPage`'s 500-row pagination without loading the
    full set into memory at once.
14. **High-frequency concurrent transfers on one wallet**: fire 50 concurrent
    small transfers against a single wallet and confirm the row lock serializes
    them correctly with no lost updates (final balance matches the sum of all
    individually-valid transfers, not fewer).
