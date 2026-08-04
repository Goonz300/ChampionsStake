# WALLET-001 — Enterprise Financial Ledger & Wallet Engine

## 1. Wallet Architecture

The double-entry ledger itself (`wallet_ledger`, the deferred balance-invariant constraint trigger, the balance-cache sync trigger) already existed from DB-001/DB-002 — this phase extends it to 5 balance types instead of 2, and builds the actual TypeScript engine on top: every wallet operation is one call to `_wallet/ledger.ts`'s `postBalancedEntries()`, which is the **only** code path that ever writes to `wallet_transactions`/`wallet_ledger`. Higher-level modules (`transfer.ts`, `service.ts`) never touch those tables directly — they build a `TransferRequest` and hand it to the ledger engine, which is what makes "every balance is ledger-derived, no exceptions" an enforced architectural fact rather than a convention someone could route around.

## 2. Folder Structure

```
supabase/functions/_wallet/          (domain library — NOT _shared, per EDGE-001's "no business logic" boundary)
  types.ts          domain types (balances, ledger legs, transaction types/statuses)
  repository.ts      typed reads (wallets, transactions, ledger, paginated wallet sweep)
  ledger.ts          postBalancedEntries — the one write path, with row-locking + balance re-validation
  service.ts          wallet lifecycle (create-if-missing, freeze/unfreeze, close)
  transfer.ts          wallet-to-wallet, lock/release-escrow primitives, platform-to-wallet, admin adjustment
  reconciliation.ts    daily sweep, paginated for 100,000+ wallets, freezes mismatched wallets
  statements.ts         running-balance statement generation + CSV export (PDF is architecture-only)
  ledger.test.ts        pure-logic unit tests (the balance-check boundary, see §9)
  WALLET_TESTS.md        14 integration/concurrency/load test specs needing a live Postgres instance
supabase/functions/
  wallet-create/ wallet-transfer/ wallet-adjustment/
  wallet-balance/ wallet-history/ wallet-reconciliation/    (6 Edge Functions, all built on EDGE-001)
supabase/migrations/0035-0039
```

## 3. Services

`WalletService` (`service.ts`): `createWalletIfMissing` (an admin recovery path — normal creation is still AUTH-001's registration trigger, Business Rules §2), `getBalance`, `freezeWallet`/`unfreezeWallet`, `closeWallet` (blocked while any sub-balance is non-zero). `ReconciliationEngine` (`reconciliation.ts`) and `StatementGenerator` (`statements.ts`) as described below.

## 4. Repository Layer

`repository.ts` — typed queries only, no business logic. One deliberate correction made while writing it: `listTransactions` queries via `wallet_ledger` (which wallet(s) a transaction actually touched) rather than filtering `wallet_transactions.wallet_id` directly — see `ledger.ts`'s design note on why a multi-wallet transaction (e.g. a future escrow release moving money between two different players) would otherwise be invisible in the *receiving* wallet's history.

## 5. Ledger Implementation

`postBalancedEntries()`: validates debits equal credits (fails fast, before any DB connection opens — this is also enforced at commit by DB-001's deferred constraint trigger, so this check is a fast-failing convenience, not the actual guarantee), opens a real Postgres transaction via EDGE-001's `withTransaction`, row-locks every distinct wallet touched **in sorted order** (prevents a lock-ordering deadlock between two concurrent transfers touching the same two wallets in opposite directions), re-validates each debit leg's available balance *after* acquiring the lock (closing the TOCTOU race a pre-lock balance check would leave open), then inserts one `wallet_transactions` row and N `wallet_ledger` legs. Zero floating-point arithmetic anywhere — every amount is a `bigint` count of cents, exactly as DB-001 established.

## 6. Transfer Engine

`transfer.ts` provides `walletToWallet`, `lockToEscrow`, `releaseFromEscrow`, `platformToWallet`, `administrativeAdjustment`. **Scope boundary, stated explicitly**: `lockToEscrow`/`releaseFromEscrow` are low-level primitives with no opinion about *when* a challenge should lock or release funds — that decision belongs to the Escrow Engine (ESCROW-001, next phase, explicitly out of scope here per "Do NOT implement escrow locking"). This phase guarantees that when a future engine calls these functions, the money moves correctly, atomically, and audibly; it does not decide to call them itself.

`wallet-transfer`'s HTTP endpoint is gated to administrators only — neither Business Rules nor the API Specification describe a player-facing "send money to another player" feature, so exposing this generic capability to ordinary players is a product decision left for a future phase to make deliberately, not assumed here.

## 7. Edge Functions

All 6 requested, built on EDGE-001's `withEdgeFunction()`: `wallet-create` (admin recovery only), `wallet-transfer` (admin-gated primitives), `wallet-adjustment` (two-step four-eyes: `POST` proposes, `PATCH` approves — requires a genuinely different administrator, enforced by a real check, not just a UI convention), `wallet-balance` (self or, with support-staff permission, another user), `wallet-history` (transactions, running-balance statement, and CSV export all behind one endpoint via `?format=`), `wallet-reconciliation` (callable by an admin or by a scheduled `pg_cron` job via shared secret, mirroring STORE-001's exact pattern).

**One schema addition beyond enum extensions**: `wallet_adjustment_requests` (migration 0038) — the four-eyes workflow needs somewhere to hold a *proposed* adjustment between the first admin's request and a second admin's approval; nothing in any prior phase created this, and without it "requires a second admin's sign-off" has no durable state to check against.

## 8. API

Realized through the 6 Edge Functions above rather than duplicate Next.js Route Handlers — Architecture always intended wallet mutations to live in Supabase Edge Functions (Architecture §4 folder structure, `supabase/functions/`), not Node-side, and EDGE-001 was built specifically to be that home.

**Realtime**: `WalletUpdated`/`BalanceChanged`/`TransactionCompleted`/`TransactionFailed` are emitted via EDGE-001's `emit()` into `domain_events` (per that phase's honesty note — this is a durable log, not an in-memory bus). `BalanceChanged` specifically is somewhat redundant with Supabase's native `postgres_changes` Realtime feature on the `wallets` table itself (which already fires on any UPDATE, including the balance-sync trigger's writes) — both exist because `domain_events` carries richer semantic context (which transaction caused it) that a bare row-change event doesn't.

## 9. Tests

`ledger.test.ts` — 4 Deno tests covering exactly the boundary that's testable without a live DB: the balance-check logic inside `postBalancedEntries` runs *before* any Postgres connection opens, so rejecting empty/unbalanced legs (including a realistic 3-leg escrow-release-with-fee shape) is genuinely unit-testable; anything past that point needs a live connection. `WALLET_TESTS.md` specifies all 14 concurrency/load/rollback/idempotency/reconciliation tests the brief calls for, precisely enough to implement directly once a live Supabase project and Deno runtime are available (neither exists in this container — confirmed by the same `deno --version` failure as EDGE-001).

## 10. Verification Checklist

- [x] Every balance is ledger-derived; `postBalancedEntries` is the only write path (verified by grep: no other file inserts into `wallet_ledger`/`wallet_transactions`)
- [x] Row locking (sorted-order `SELECT ... FOR UPDATE`) prevents both double-spend and lock-ordering deadlocks
- [x] Idempotency enforced at the HTTP layer (EDGE-001's `beginIdempotentRequest`) for `wallet-transfer`, and via a natural UUID (the adjustment request's own id) for `wallet-adjustment`'s execution step
- [x] Four-eyes approval genuinely requires a different administrator — checked in code (`pending.proposed_by === ctx.user!.id` throws), not just documented as a policy
- [x] Zero floating-point arithmetic anywhere — all amounts are `bigint` cents
- [x] All new files (5 migrations, 7 `_wallet/` modules, 6 Edge Functions) pass a comment/string-aware bracket-balance check, and every cross-module import was verified to resolve to a real export (both checks re-run across the *entire* `supabase/functions` tree after modifying two EDGE-001 shared files, to confirm nothing broke)
- [x] `DomainEventType` (EDGE-001) extended with the 5 wallet-specific event names this phase needed, rather than silently relying on the union's `string &{}` escape hatch
- [ ] **Not verified in this environment**: no Deno runtime, no network, no live Postgres — same confirmed limitation as every prior phase. `ledger.test.ts` and all 14 tests in `WALLET_TESTS.md` still need to run for real.

## 11. Financial Integrity Report

**What's structurally guaranteed by the database itself** (not just application code): debits always equal credits per transaction (deferred constraint trigger, DB-001), the 5 cached balance columns can only be written by the sync trigger (column-level `REVOKE` + guard trigger, DB-002/this phase), `wallet_transactions` can never be deleted and cannot be mutated once terminal (DB-001 triggers), `wallet_ledger` rows are fully immutable from the moment of insert.

**What's guaranteed by this phase's application code**: no debit is accepted without a fresh (post-lock) balance check, concurrent transfers on the same wallet pair cannot deadlock, a wallet adjustment cannot be self-approved, and every mismatch reconciliation finds results in an immediate freeze rather than a silent auto-correction.

**What remains a documented gap, not a silent one**: the actual concurrency/load/reconciliation-drift tests need to run against a real database before this can be called production-verified — §9/§10 above are explicit about exactly which 14 scenarios that covers.

## Stop point

WALLET-001 is complete. Per your instruction, stopping here and awaiting approval before ESCROW-001.
