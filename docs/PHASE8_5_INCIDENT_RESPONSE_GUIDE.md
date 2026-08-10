# Phase 8.5 — Incident Response Guide

Extends `docs/INCIDENT_RESPONSE_GUIDE.md` (Phase 5) and `docs/INCIDENT_RESPONSE_GUIDE_PHASE6.md` with scenarios specific to Phase 7/8/8.5's additions (AI platform, tournament ecosystem, this phase's own hardening). Same format: symptoms, then numbered response steps.

## 1. Wallet reconciliation mismatch

**Symptoms**: `wallet_reconciliation_runs.status = 'completed_with_mismatches'`; one or more wallets auto-frozen (Business Rules §15, `_wallet/reconciliation.ts`).

**Response**:
1. **Treat as the highest-priority financial incident class** — a mismatch means the structural ledger-balance guarantee (`docs/PHASE8_5_FINANCIAL_VERIFICATION.md`) was somehow defeated, which this system's entire design assumes cannot happen.
2. Query the frozen wallet(s) directly: `select * from wallet_reconciliation_runs order by started_at desc limit 1` for the run details, then run `docs/PHASE8_5_FINANCIAL_VERIFICATION.md`'s "cached-vs-ledger drift" query filtered to the specific wallet(s).
3. Do **not** unfreeze the wallet or manually adjust its cached balance columns — those columns are guarded by `fn_guard_wallet_balance_columns()` and can only be legitimately written by the sync trigger; a manual UPDATE would either fail (correctly) or, if done via superuser bypass, would be exactly the kind of out-of-band write this system is designed to prevent. Investigate via `wallet_ledger` (the source of truth) instead.
4. Determine root cause before any remediation: was this a genuine application bug (check recent deploys/migrations), a direct/manual database write outside the application (audit `pg_stat_activity`/connection logs if available), or a `fn_wallet_balance`/sync-trigger bug itself.
5. Only after root cause is understood and fixed: manually correct via a new, explicit, audited ledger entry restoring balance (never by editing existing rows — `wallet_ledger` is append-only/immutable by trigger), then unfreeze via `admin-wallets`.

## 2. Moderator acting on a dispute outside their assignment

**Symptoms**: a dispute's resolution doesn't match who was shown as assigned; a moderator reports acting on a case they don't remember claiming.

**Context**: this phase's hostile review found and fixed exactly this bug class (an inverted authorization condition that made the assignment check a silent no-op) — see `docs/PHASE8_5_SECURITY_REVIEW.md`. The fix is deployed and regression-tested (`_moderator/authorization-heuristics.test.ts`), but if this symptom recurs, treat it as seriously as its first discovery.

**Response**:
1. Check `audit_logs` for the dispute (`category='moderation'`) — every decision function records `actorId`, so the actual acting moderator is always attributable regardless of whether the assignment check should have blocked them.
2. Confirm the fix is actually deployed (`_moderator/cases.ts`'s `assertModeratorOnDispute` should throw, not silently return, when `assignedModeratorId` differs from the caller) — a recurrence after the fix's deploy date would indicate either a rollback or a new bypass, both urgent.
3. If genuinely a new bypass: treat as a Critical security incident, same escalation as any other authorization-bypass finding in `docs/PHASE7_8_SECURITY_REVIEW.md`/`docs/PHASE8_5_SECURITY_REVIEW.md`.

## 3. Tournament round stuck (no progression)

**Symptoms**: a tournament's bracket hasn't advanced past a round despite all expected matches appearing complete or cancelled; a participant reports "waiting forever."

**Response**:
1. Check the round's matches: any `challenges` row in `cancelled` status that's part of this round's `tournament_matches`? This is the known gap documented in `docs/PHASE8_5_TOURNAMENT_CORRECTNESS.md` — a suspended/banned participant's match gets refunded but the tournament isn't notified, leaving their opponent stuck.
2. If confirmed: manually determine the correct resolution (advance the remaining player as a bye, or void the match per organizer discretion) and apply it through the existing moderator/admin tournament tools — there is no automated path for this yet.
3. File this as a concrete instance for the future milestone that needs to close this gap properly (see the same doc's recommendation) — recurrence data helps prioritize it.

## 4. Season reward payout looks wrong

**Symptoms**: a season-end reward amount doesn't match expectation; a league/season was created and ended in a way that produced an unusually large payout.

**Context**: this exact exploit (unbounded, self-service reward minting) was the most severe finding in the Phase 7/8 hostile review and is fixed (`league-manage` now requires the `organizer` role for every mutation — see `docs/PHASE7_8_SECURITY_REVIEW.md`'s Critical #2).

**Response**:
1. Confirm the account that created the league/season actually holds the `organizer` role legitimately (was it admin-granted, and to a real, vetted organizer) — the fix closes the *unauthorized* path, but a legitimately-organizer-role account can still set an unreasonable `rewardStructure` (this is now a trust/vetting boundary, not a code-level cap, by deliberate design — see the same doc's rationale).
2. Check `audit_logs` for `action='SeasonEnded'`, `metadata.rewardsIssued` for the actual computed amounts and recipient list.
3. If the amount is legitimate but organizer judgment was poor: this is an account-standing/vetting conversation, not a security incident.
4. If the `organizer` role check itself appears bypassed: Critical security incident, same escalation as #2 above.

## 5. Realtime/Supabase outage

**Symptoms**: websocket connections failing to establish or dropping en masse; Edge Function invocations timing out.

**Response**:
1. Check Supabase's own status page first — this is managed infrastructure this codebase doesn't control the availability of.
2. Confirm the frontend's Realtime reconnection is actually working once Supabase recovers (`apps/web/lib/realtime/useRealtimeChannel.ts` delegates to the Supabase client's own bounded exponential backoff — see `docs/PHASE8_5_CHAOS_ENGINEERING.md`) — spot-check a live page rather than assuming.
3. Check whether any scheduled sweep missed its window during the outage — every sweep is designed to be self-healing (unprocessed rows just wait for the next run, see the chaos engineering doc's "worker crashes" finding), so a missed run should self-correct on the next scheduled invocation without manual intervention, but verify this actually happened for the sweeps most sensitive to backlog (`notification-send`, `ranking-engine`).

## 6. Third-party integration hanging (Paystack / Resend / Expo / Upstash)

**Symptoms**: elevated latency or timeouts specifically on payment, email, push, or rate-limit-adjacent requests.

**Context**: this phase found none of these 6+ outbound calls had a timeout and fixed all of them (`docs/PHASE8_5_CHAOS_ENGINEERING.md`) — a hang should now surface as a bounded failure (2-15s depending on the call) rather than an indefinite hold.

**Response**:
1. Check the third party's own status page.
2. Confirm the relevant fallback engaged correctly: rate-limit calls should have fallen through to the Postgres backend (`_shared/security/rate-limit.ts` logs a warning when this happens — search Edge Function logs for "falling back to Postgres"); push/email failures should be logged but not have blocked their caller (`processUnhandledEvents` continuing to the next recipient/event).
3. If a timeout value itself seems miscalibrated in practice (e.g. Paystack's real p99 latency exceeds the 15s budget under normal conditions), that's a tuning follow-up, not an incident — adjust the constant in the relevant file and note why in the commit.
