# Wallet Architecture

Status: as-built, verified against the actual repository at the end of Phase 6 — not aspirational.

## 1. Model

One wallet per user (`wallets.user_id unique`), single-currency (`chk_wallets_currency check (currency = 'USD')`). Multi-wallet and multi-currency are **not implemented and were not built in Phase 6** — confirmed deliberate, DB-enforced architecture from DB-001/WALLET-001, not a gap.

Five ledger-derived sub-balances, each a cached projection of `wallet_ledger`, never written directly (enforced by `fn_guard_wallet_balance_columns`):

| Sub-balance | Column | Meaning |
|---|---|---|
| Available | `available_cents` | Spendable now |
| Escrowed | `escrowed_cents` | Locked in an active challenge/tournament |
| Pending | `pending_cents` | In-flight (e.g. a withdrawal awaiting provider confirmation) |
| Bonus | `bonus_cents` | Promotional credit |
| Referral | `referral_cents` | Referral-program credit |

## 2. Concurrency

`postBalancedEntries` (`_wallet/ledger.ts`) locks every wallet involved in a transfer via `SELECT ... FOR UPDATE`, in **sorted wallet-id order** — deliberate, to prevent lock-ordering deadlocks when two transfers touch the same two wallets in opposite order. Balance sufficiency is re-checked *after* the lock is acquired (not before), closing the TOCTOU race a pre-lock check would leave open.

## 3. Negative Balance Prevention

Two independent layers:
- **Database**: `chk_wallets_*_nonneg` CHECK constraints on all five sub-balance columns.
- **Application**: the ledger-derived balance is computed and checked *inside* `postBalancedEntries`, before any INSERT is attempted, so a would-be-negative debit fails with a clear `WalletError` rather than surfacing as an opaque constraint violation.

## 4. Freeze / Unfreeze

`_wallet/service.ts`'s `freezeWallet`/`unfreezeWallet`, callable by an admin (`admin-wallets`) or automatically by the nightly reconciliation sweep on a detected mismatch (`_wallet/reconciliation.ts`).

## 5. Statements

`generateStatement` (`_wallet/statements.ts`) computes a running-balance statement forward from the wallet's ledger-derived balance at the *start* of the requested range — not backward from the current cached balance, which would be wrong the instant a new transaction lands mid-computation.

**Phase 6 fix**: this function previously issued one additional query per transaction inside its line-building loop (a real N+1 pattern, confirmed by this phase's audit — up to 10,000 extra round trips for a wide-date-range statement on a heavy-activity wallet). Now issues one batched query for every transaction's ledger legs, grouped in memory.

Export formats: CSV (fully implemented, pure string formatting). PDF is an intentionally unimplemented, documented interface (`StatementPdfExporter`) — WALLET-001's own brief explicitly deferred the PDF-library choice rather than making it unilaterally, and Phase 6 respected that decision (a genuinely new dependency choice, out of scope for a gap-driven phase) rather than picking a library without review.

## 6. Currency / FX

The wallet ledger is labeled `USD` but Paystack (the only payment provider) charges/pays in `NGN`. `amountCents` flows through both sides 1:1 with no conversion — confirmed as a pre-existing, symmetric, deliberate simplification from PAYMENT-001 (not something Phase 6 introduced or "fixed"), effectively treating the platform's internal unit as nominal rather than literally USD. No FX/conversion logic exists anywhere in `_wallet`/`_payment`. Documented here as a known limitation, not touched — building real FX conversion would need a live rate provider (none available) and would be exactly the kind of unrequested architecture change this phase's brief forbids.

## 7. What Phase 6 Changed

The wallet architecture itself (locking, balance derivation, negative-balance prevention, freeze/unfreeze) was already sound and is unchanged. Phase 6's only wallet-adjacent fixes:
1. `chk_wallet_ledger_account_wallet_pairing` widened to permit `pending`/`bonus`/`referral` account types for wallet-scoped legs (migration 0081) — see [LEDGER_ARCHITECTURE.md](LEDGER_ARCHITECTURE.md) §5.
2. `generateStatement`'s N+1 query fix (above).

See [ACCOUNTING_DESIGN.md](ACCOUNTING_DESIGN.md) for the ACID/transaction model behind every wallet mutation.
