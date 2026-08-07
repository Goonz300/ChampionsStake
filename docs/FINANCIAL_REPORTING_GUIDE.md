# Financial Reporting Guide

## 1. Per-Wallet Statements

`admin-wallets?view=statement&userId=...&from=...&to=...&format=json|csv` (admin) or the equivalent player-facing `wallet-history?view=statement` route. Returns a running-balance statement (see [WALLET_ARCHITECTURE.md](WALLET_ARCHITECTURE.md) §5) — computed forward from the balance at the start of the range, not backward from the current balance.

CSV format is fully implemented. PDF is not (see Wallet Architecture §5 for why this was a deliberate prior-phase decision, respected rather than overridden in Phase 6).

## 2. Transaction / Ledger Views

- `admin-wallets?view=transactions&userId=...` — paginated `wallet_transactions` history.
- `admin-wallets?view=ledger&userId=...` — raw `wallet_ledger` legs for a wallet.
- `admin-wallets?view=balance&userId=...` — current cached balance (all five sub-balances).

## 3. Phase 6: Pending-Review Withdrawal Queue

`admin-wallets?view=pending_review_withdrawals` — every withdrawal currently held at `status='pending_review'` (Phase 6's manual-review threshold), oldest first. This is the operational queue an administrator works from; see the [Incident Response Guide](INCIDENT_RESPONSE_GUIDE_PHASE6.md) §2 for the review workflow itself.

## 4. Phase 6: Sanctions Blocklist

`admin-wallets?view=sanctions_blocklist` — the current administrator-maintained blocklist (see [FRAUD_INTEGRATION.md](FRAUD_INTEGRATION.md) §2).

## 5. Reconciliation Reports

`wallet_reconciliation_runs` — full history of every nightly (and on-demand) reconciliation sweep, including which wallets (if any) were found mismatched and auto-frozen. RLS permits direct admin `SELECT` against this table via PostgREST; **no dedicated aggregated admin-Edge-Function view exists for reconciliation history** — confirmed by this phase's audit as a real, if narrow, gap (the underlying data and RLS access both exist; only a purpose-built "reconciliation dashboard" endpoint doesn't). Not built in Phase 6, since a raw table query already satisfies the actual data-access need and building a dedicated view for it wasn't a proven functional gap, only a UX convenience gap. See [RECONCILIATION_GUIDE.md](RECONCILIATION_GUIDE.md).

## 6. Platform-Wide Financial Reports

`_admin/analytics.ts`/`_admin/dashboard.ts` (pre-existing, `admin-system-health`) provide platform-wide metrics — user growth, challenge/tournament volume, revenue, escrow statistics, dispute statistics. These touch `escrow_accounts` (now accurate again as of Phase 6's BUG B fix, see [ESCROW_ARCHITECTURE.md](ESCROW_ARCHITECTURE.md)).

**No dedicated "total deposits / total withdrawals / net revenue / fee revenue over a period" report exists** as a single endpoint distinct from per-wallet statements — confirmed by this phase's audit. Not built: the underlying data (`wallet_ledger`, filterable by `account_type='platform_fee_revenue'`) is fully queryable by an administrator today via the existing `admin-wallets?view=ledger` surface scoped per-wallet, or directly via PostgREST for a platform-wide aggregate; a dedicated aggregation endpoint was judged a genuine but lower-priority gap relative to the correctness bugs (BUG A/B/C) this phase prioritized, and building it without a concrete consumer/requirement would have been speculative.

## 7. Scheduled / Automated Reports

None exist. The only scheduled financial job is the nightly reconciliation sweep (an integrity check, not a report). No periodic emailed financial summary or similar exists in this codebase.
