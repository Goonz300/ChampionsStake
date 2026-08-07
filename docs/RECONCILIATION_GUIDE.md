# Reconciliation Guide

Note: this is the financial-platform (wallet/ledger/escrow) reconciliation guide. It complements, and does not replace, [OPERATIONAL_RUNBOOK.md](OPERATIONAL_RUNBOOK.md) from Phase 5 (rate limiting/security operations).

## 1. Wallet Balance Reconciliation (Pre-Existing, Verified Sound)

`_wallet/reconciliation.ts`'s `runReconciliation` compares every wallet's cached `*_cents` columns against `fn_wallet_balance()` (a pure ledger-derived sum) for all five sub-balances. A mismatch:
1. Freezes the wallet (`freezeWallet`) — no further withdrawals/transfers until an admin investigates and unfreezes.
2. Records a durable row in `wallet_reconciliation_runs` (queryable, not just logged).

Scheduled nightly (`pg_cron`); also callable on-demand via `wallet-reconciliation`.

**Given migration 0081's fix (see below), re-run reconciliation manually after deploying Phase 6** if any withdrawals or bonus credits were attempted (and failed) against a pre-fix database — a failed INSERT never wrote a `wallet_ledger` row, so the cached balance and ledger-derived balance should already agree in that case (nothing was ever partially applied), but confirming this with an explicit reconciliation run is cheap and worthwhile after any schema fix touching the ledger.

## 2. Escrow Reconciliation (Phase 6 — New Capability)

Before Phase 6, `escrow_accounts.total_locked_cents`/`status` were never updated after row creation (BUG B) — there was nothing meaningful to reconcile *against*, since the observability table itself was permanently stale. As of this phase's fix, `escrow_accounts` now accurately tracks locked/released state via `recordEscrowLock`/`recordEscrowRelease`.

**No automated escrow-vs-ledger reconciliation job exists yet.** A manual spot-check: for any `escrow_accounts` row with `status='locked'`, the sum of `wallet_ledger` `escrowed` credits minus debits for the wallets tied to that challenge/tournament (joinable via `wallet_transactions.related_challenge_id`/`related_tournament_id`, confirmed present in migration 0004) should equal `total_locked_cents`. Building this into an automated sweep (mirroring `runReconciliation`'s pattern) is a reasonable follow-up, not built in this phase since no concrete drift was observed to justify it yet — the bookkeeping is newly accurate going forward, and pre-fix rows self-heal to zero on their next release (see [ESCROW_ARCHITECTURE.md](ESCROW_ARCHITECTURE.md) §4).

## 3. Withdrawal-Limit Reconciliation (Phase 6)

`assertWithinWithdrawalLimits` computes daily/monthly totals live, on every withdrawal request — there is no separate reconciliation step for this control, since it's not a cached value that could drift (it's recomputed from `payment_intents` on every check).

## 4. Sanctions Blocklist (Phase 6)

Not a reconciliation concern in the traditional sense — it's an administrator-maintained list checked in real time, not a cached derived value. Auditing "was every existing payout method screened against the current blocklist" (i.e., re-screening after a new entry is added) is a manual admin action today: pull `admin-wallets?view=sanctions_blocklist` alongside `payout_methods` and cross-reference by name. Not automated in Phase 6.

## 5. Prize Distribution Verification (Phase 6)

After `triggerPrizeDistribution` runs for a tournament, verify: `sum(registrant entry fees) = sum(placement-winner credits) + platform_fee_revenue leg for that transaction`. This is enforced *at write time* by `postBalancedEntries`' own balance check (a mismatch would have thrown, not silently succeeded) — so any completed prize distribution is balanced by construction. A post-hoc spot-check is still reasonable for confidence: query `wallet_ledger` filtered by the transaction's `wallet_transaction_id` and confirm debits equal credits (they will, or the row wouldn't exist).
