# Fraud Integration (Financial Surface)

Scope: how the financial platform (wallet/escrow/payments) integrates with the fraud/trust infrastructure built in AI-001 and Phase 5. This is not a re-description of that infrastructure — see the Phase 5 Threat Model and `docs/AI-001-deliverable.md` for those.

## 1. Existing Signals (Unchanged)

- `checkVelocity` (Phase 5, `_shared/security/velocity.ts`) — withdrawal velocity flags `fraud_flags` (`suspicious_withdrawal` type) when a user submits more than `FRAUD_WITHDRAWAL_VELOCITY_MAX` withdrawals within `FRAUD_WITHDRAWAL_VELOCITY_WINDOW_SECONDS`. Flag-only, never blocks, called from `payment-transfer` after the withdrawal has already been submitted.
- `checkRepeatedOpponent`/`checkMultiAccount` (AI-001, `_ai/fraud-detection.ts`) — collusion/multi-account signals scoped to challenge participants, unrelated to the wallet surface directly.

## 2. Phase 6's Own New Signal: Sanctions/PEP Screening

**Confirmed missing before this phase** (grep for "sanction"/"OFAC"/"PEP" across `supabase/functions/` returned zero hits). No live sanctions/PEP data provider is reachable from this sandboxed environment — no API credentials, no external network access to a real screening service.

Rather than build an "architecture-ready" stub that checks against nothing, `_payment/sanctions.ts` implements a genuinely functional, administrator-maintained blocklist (`sanctions_blocklist`, migration 0084):

- **What it checks**: exact, normalized (lowercased, whitespace-collapsed) name match — not fuzzy matching. A false negative is a real risk with exact matching, but so is a false positive blocking a legitimate payout on a coincidental fuzzy match with no provider data to disambiguate against.
- **When it runs**: at payout-method creation (screening the payment *provider's* bank-verified resolved account name, not the client-supplied one — screening only client input would be trivially bypassable) and again at withdrawal time (catching a name added to the blocklist after the payout method was already on file).
- **How it fails**: open. A broken blocklist query must not itself block every withdrawal platform-wide — same rationale as every other infrastructure-failure guard in this codebase (see Phase 5's Threat Model for the pattern).
- **Admin surface**: `admin-wallets`' `add_sanctions_blocklist_entry`/`remove_sanctions_blocklist_entry`/`sanctions_blocklist` view.
- **Migration path to a real provider**: a future phase with actual sanctions/PEP API access can populate this same table from that feed (or add a live-API check alongside it) without any existing call site (`assertNotSanctioned`) needing to change — the interface is stable.

## 3. Escrow/Ledger Bookkeeping as a Fraud-Adjacent Signal

Not a fraud signal itself, but worth noting: Phase 6's escrow bookkeeping fix (BUG B, see [ESCROW_ARCHITECTURE.md](ESCROW_ARCHITECTURE.md)) makes `escrow_accounts`/`escrow_transactions` accurate for the first time — the admin/moderator dashboards that fraud investigators actually use (`_admin/analytics.ts`, `_moderator/cases.ts`) were previously reading permanently-stale data when investigating a specific challenge/tournament's escrow history. This is an investigative-accuracy fix, not a new detection signal.

## 4. Explicitly Not Built

- Withdrawal-limit or manual-review-threshold **breaches** do not themselves generate a `fraud_flags` row — they're hard controls (reject/hold), not soft signals. A user hitting their daily limit repeatedly is visible via `payment_intents` query patterns, not a dedicated flag; adding one was judged unnecessary duplication of what the hard control already surfaces via `audit_logs`.
- No automated fraud-score-driven withdrawal blocking — `checkVelocity`'s flags remain purely informational for the financial surface, consistent with the platform-wide "never auto-block funds without human review" rule established in AI-001 and preserved through Phase 5.
