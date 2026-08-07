# Incident Response Guide — Phase 6 (Wallet, Ledger, Escrow & Financial Platform)

Companion to [INCIDENT_RESPONSE_GUIDE.md](INCIDENT_RESPONSE_GUIDE.md) (Phase 5). Financial-platform-specific incidents only.

## 1. Suspected Ledger Imbalance

**Symptoms**: a `wallet_reconciliation_runs` row shows a mismatch; a wallet was auto-frozen.

**Response**:
1. This should be structurally rare — `trg_wallet_ledger_validate_balance` (a deferred constraint trigger) rejects any unbalanced transaction at the database layer, independent of application code. A genuine imbalance means either (a) the trigger itself was bypassed (e.g. a direct `service_role` write outside `postBalancedEntries` — audit for any raw `wallet_ledger` INSERT not going through `_wallet/ledger.ts`), or (b) the cached column and the ledger-derived sum have drifted for a reason other than an actual imbalance (e.g. a `fn_sync_wallet_cached_balance` trigger bug).
2. Do **not** manually adjust `wallet_ledger` rows to "fix" the number — they're immutable by design (`trg_wallet_ledger_immutable`), and a manual correction outside the established pattern (an `administrativeAdjustment`-style balanced entry) would itself be a new potential imbalance.
3. Use `wallet_adjustment_requests` (the existing four-eyes admin adjustment flow) for any corrective credit/debit — never a direct table write.
4. Keep the wallet frozen until the root cause is understood, not just until the numbers happen to match again.

## 2. Reviewing a Held Withdrawal (Manual Review Queue)

**Symptoms**: none — this is routine operation, not an incident, but the workflow is documented here since it's new in Phase 6.

**Response**:
1. `GET admin-wallets?view=pending_review_withdrawals`.
2. Cross-reference the user's recent activity (`admin-wallets?view=transactions&userId=...`), any open `fraud_flags`, and the withdrawal's amount against the account's history.
3. Approve (`POST admin-wallets {action: "approve_withdrawal", intentId}`) — this is the point real money leaves the platform. There is no undo after approval succeeds (the provider transfer has been initiated).
4. Reject (`POST admin-wallets {action: "reject_withdrawal", intentId, reason}`) — funds return to the user's `available` balance immediately; no provider call is ever made for a rejected withdrawal.
5. A withdrawal left un-reviewed indefinitely is a real user's money on hold — see the Operational Runbook's note on the lack of queue-age alerting.

## 3. Suspected Tournament Prize Distribution Error

**Symptoms**: a tournament reached `completed` status but a winner reports not receiving their prize, or the distributed amount looks wrong.

**Response**:
1. `postBalancedEntries` guarantees the transaction that *did* commit is balanced — if `triggerPrizeDistribution` ran to completion, debits equal credits by construction. A "missing" payout more likely means either the function threw before completing (check `audit_logs` for a `PrizeDistributionTriggered` entry with no matching `TournamentPrizesDistributed` entry afterward) or the standings were derived incorrectly.
2. Check `getFinalStandings`' inputs: confirm the final round's match actually has a `winner_submitted_by` set, and that the semifinal round (if any) was correctly identified (`round_number - 1`).
3. If `payout_structure` names a placement beyond 1st/2nd/3rd, `triggerPrizeDistribution` refuses to run at all (throws, tournament stays in `prize_distribution`) rather than guessing — this is expected, not a bug, if it happens. Distribute manually via the existing `wallet-transfer`/`admin-wallets` primitives in that case, and consider whether the tournament's `payout_structure` was misconfigured.
4. If a tournament genuinely ran to `completed` with an incorrect distribution (e.g. a bug in `computePayoutShares`, unlikely given its 4 unit tests, but not impossible for an untested edge case), the corrective action is a `wallet_adjustment_requests` four-eyes adjustment to the affected wallets — never a retroactive edit of the already-committed `wallet_ledger` rows.

## 4. Sanctions Blocklist Hit

**Symptoms**: a user reports their payout-method creation or withdrawal was rejected with "This request could not be processed. Please contact support."

**Response**:
1. Check `audit_logs` for a `SanctionsScreeningBlocked` entry against that user — confirms this is genuinely a blocklist hit, not an unrelated error surfaced with the same generic message.
2. This message is deliberately generic (does not reveal *why* to the end user) — do not disclose blocklist details to the affected user directly; escalate per the organization's actual compliance process for a sanctions match, which is outside this codebase's scope to define.
3. If the match is a false positive (a legitimate user coincidentally sharing a normalized name with a blocklist entry), remove the specific blocklist entry (`admin-wallets`' `remove_sanctions_blocklist_entry`) only after genuine verification — exact-name matching means removing an entry re-opens screening for anyone sharing that exact normalized name, not just the one user in question.

## 5. Emergency: Disabling a Withdrawal Control

All Phase 6 withdrawal thresholds (`WITHDRAWAL_DAILY_LIMIT_CENTS`, `WITHDRAWAL_MONTHLY_LIMIT_CENTS`, `WITHDRAWAL_MANUAL_REVIEW_THRESHOLD_CENTS`) are environment-variable-driven and can be raised (effectively disabling the control for realistic volumes) without a code deploy. There is no "off" switch for sanctions screening or MFA/AAL2 enforcement short of removing their call sites in code — deliberately, matching Phase 5's established pattern of not providing a single misconfigurable flag that silently disables a compliance-relevant control platform-wide.
