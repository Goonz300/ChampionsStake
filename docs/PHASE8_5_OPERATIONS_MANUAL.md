# Phase 8.5 — Operations Manual

Day-to-day operational reference. For "something's actively broken," see `PHASE8_5_INCIDENT_RESPONSE_GUIDE.md` instead — this document is for routine operation, not firefighting.

## Daily

- **Wallet reconciliation**: runs automatically at 03:00 UTC (`_wallet/reconciliation.ts`, migration `0039`). Check `wallet_reconciliation_runs` for the prior night's result — `status = 'completed_with_mismatches'` means at least one wallet was auto-frozen and needs manual review (see Runbooks: "Reconciliation mismatch found").
- **Moderation queue**: `v_moderator_queue` (surfaced via `moderator-dashboard?view=queue`) — since the Phase 7/8 hostile review fix, this now also shows `ai_suggested_priority`/`ai_confidence` per case, joined from the AI Moderation Assistant's output. Priority is still human-set; the AI signal only breaks ties within the same priority tier.
- **Fraud flags**: `moderator-dashboard`/`admin-security`'s `listFraudFlags` view (now `.limit(200)`-capped per the Phase 8.5 performance fix) — review open flags, especially any the automated sweeps (`ai-fraud-scan`) raised overnight.

## Weekly

- Review `docs/PHASE8_5_FINANCIAL_VERIFICATION.md`'s SQL queries against production directly, even though the automated sweep already runs nightly — an independent cross-check catches anything a bug in the sweep itself might miss.
- Spot-check `audit_logs` for any privileged action (role grants, wallet adjustments, dispute overrides) that doesn't match expected admin activity.
- Review dependency vulnerability status: `npm audit` (frontend), and check Deno's `deno.lock` age — this phase found and fixed 2 Critical CVEs (`next`, `vitest`) that had been sitting unpatched; don't let that recur.

## Monthly

- Re-run `npm outdated`/`npm audit --omit=dev` and evaluate whether any newly-available patch closes an open vulnerability (see `PHASE8_5_INFRASTRUCTURE_AUDIT.md`'s residual-risk table — `next`/`postcss`/`sharp` need a major-version migration this phase deliberately deferred; check whether that's become more urgent).
- Review `PHASE8_5_SCALING_GUIDE.md`'s capacity indicators against actual traffic growth.

## Granting the organizer role

Tournament creation and league-manage's mutating actions require `profiles.role = 'organizer'` — admin-granted, not self-service, by explicit design (real money, no self-service fraud track record — see `docs/ORGANIZER_PLATFORM_DESIGN.md` §1 and the two Critical fixes in `docs/PHASE7_8_SECURITY_REVIEW.md` that this restriction closes). Grant it the same way `moderator`/`administrator` role grants already work (`admin-users` role update) — no dedicated endpoint exists for this specifically, since the existing role-management surface already covers it.

## Common admin actions and where they live

| Action | Edge Function |
|---|---|
| Suspend/reinstate a user | `admin-users` |
| Grant/revoke a role (organizer/moderator/administrator) | `admin-users` |
| Review/resolve a fraud flag | `admin-security` |
| View system health | `admin-system-health` |
| Force-cancel a challenge (before it goes live) | `admin-challenges` |
| View/adjust a wallet (four-eyes approval required for adjustments) | `admin-wallets` |
| Review audit trail | `admin-audit` |

## Known operational gap: suspending a user mid-tournament

Per `docs/PHASE8_5_TOURNAMENT_CORRECTNESS.md`: `suspendUser` correctly force-cancels and refunds the suspended player's pending tournament match, but does **not** mark them forfeited in `tournament_registrations` or advance their opponent. If you suspend a player who's actively in a tournament bracket, **manually check that tournament's current round afterward** — the opponent may be stuck waiting on a match that was cancelled out from under them, and the round may need manual intervention (advance the opponent, or contact the organizer) until this gap is closed in a future milestone.
