# Operational Runbook — Phase 6 (Wallet, Ledger, Escrow & Financial Platform)

Companion to [OPERATIONAL_RUNBOOK.md](OPERATIONAL_RUNBOOK.md) (Phase 5, rate limiting/security). This document covers financial-platform-specific operations only.

## 1. Deployment Checklist

- [ ] Run migrations `0081`–`0084` in order. **`0081` is the highest-priority migration in this phase** — it fixes a CHECK constraint that currently blocks every withdrawal and bonus credit from completing against a real database. Deploy it first, independent of everything else in this phase if a staged rollout is preferred.
- [ ] After `0081` deploys, run `wallet-reconciliation` manually once and review `wallet_reconciliation_runs` for any unexpected mismatch (none is expected — see [RECONCILIATION_GUIDE.md](RECONCILIATION_GUIDE.md) §1).
- [ ] Set `WITHDRAWAL_DAILY_LIMIT_CENTS`/`WITHDRAWAL_MONTHLY_LIMIT_CENTS`/`WITHDRAWAL_MANUAL_REVIEW_THRESHOLD_CENTS` for the actual deployment (defaults: $5,000/day, $50,000/month, $2,000 review threshold — chosen as reasonable starting points, not validated against real platform economics).
- [ ] Populate `sanctions_blocklist` with any known entries before go-live if sanctions screening needs to be effective from day one — it starts empty.
- [ ] Confirm `apps/web`'s login flow already sets the `aal` claim correctly for MFA-enrolled users (pre-existing GoTrue behavior, not changed by this phase) — `requireAal2IfMfaEnrolled` depends on it being present and accurate.

## 2. Monitoring

### Pending-Review Withdrawal Queue

`GET admin-wallets?view=pending_review_withdrawals` should be checked regularly — a withdrawal sitting in `pending_review` indefinitely means a real user's funds are on hold with no resolution. **No SLA/alerting exists for queue age in this phase** — this is a pull-based queue, not push-notified. Consider adding an admin-facing "age > N hours" indicator in a future phase if the queue is expected to see meaningful volume.

### Reconciliation Runs

`wallet_reconciliation_runs`, checked nightly by the pre-existing scheduled sweep. A frozen wallet (auto-frozen on mismatch) blocks that user's withdrawals/transfers until manually investigated and unfrozen (`admin-wallets`' `unfreeze` action) — this is unchanged from before Phase 6.

## 3. Known Operational Gaps (Stated Honestly)

- **No automated alerting** on: pending-review queue depth/age, sanctions blocklist hits, or withdrawal-limit rejections. All are visible via `audit_logs`/direct query, none are push-notified. Same characteristic as Phase 5's `abuse_stats` endpoint — pull-based, not push-based.
- **Escrow reconciliation is manual** (see [RECONCILIATION_GUIDE.md](RECONCILIATION_GUIDE.md) §2) — no automated sweep exists yet for `escrow_accounts` vs `wallet_ledger` drift, since the bookkeeping is newly accurate as of this phase and no drift has been observed to justify building one yet.
- **No live sanctions/PEP data feed** — the blocklist is only as good as what an administrator manually enters. See [FRAUD_INTEGRATION.md](FRAUD_INTEGRATION.md) §2 for the honest scoping rationale.
- **Sub-in-flight-withdrawal-limit doesn't distinguish approved-but-not-yet-settled from truly-pending** for the purposes of the daily/monthly cap — a withdrawal held for review counts against the limit the moment it's requested, not just once approved. This is the conservative (safer) direction — it can only under-count available limit headroom, never over-count it — but is worth knowing if a user's limit usage looks higher than their completed-withdrawal history alone would suggest.

## 4. Rolling Back This Phase

Every migration (`0081`–`0084`) has a paired `.down.sql`. **Rolling back `0081` re-breaks withdrawals and bonus credits** (restores the original, too-narrow CHECK constraint) — only roll it back if reverting to a build that predates any `pending`/`bonus`/`referral` `wallet_ledger` rows, since existing rows using those account types would violate the restored constraint. `0083`'s new `payment_intent_status` value (`pending_review`) and `0084`'s enum-adjacent additions cannot be dropped by PostgreSQL once added — the rollback scripts document this rather than attempting an unsafe drop.

## 5. Load-Testing / Live-Verification Gap

No live Supabase project, Postgres connection, or Paystack sandbox exists in this development environment. Every claim in this phase's documentation about concurrent-locking behavior, the deferred constraint trigger firing correctly, and the manual-review withdrawal flow's end-to-end correctness is grounded in code review and offline (pure-logic) testing — not executed against a real database or a real payment provider. This mirrors the exact same limitation stated in Phase 5's runbook and in `_wallet/WALLET_TESTS.md`'s own header.
