# Phase 8.5 — Tournament Correctness Verification

## Bracket formats

All four formats (single elimination, double elimination, Swiss, round robin) are implemented in `_tournament/bracket.ts` and covered by `bracket.test.ts` (13 test cases): standard seeding (1v8/4v5/2v7/3v6 for 8 players), bye distribution for non-power-of-two fields, exclusion of no-shows/forfeits from pairing, next-round pairing, double-elimination winners/losers-bracket seeding and grand final construction, round-robin full round-trip with bye handling for odd fields, and Swiss score-group pairing with rematch avoidance (including the float-down case when a score group has an odd number of players). No gap found — this was already thoroughly verified in Phase 8's own implementation and re-confirmed here by re-reading the test file against the actual generator functions, not just trusting the prior phase's claim.

## League/season rollover

Covered in depth in `docs/PHASE7_8_SECURITY_REVIEW.md` (the season-reward-minting Critical fix) and `docs/LEAGUE_PLATFORM_DESIGN.md`/`SEASON_PLATFORM_DESIGN.md`. Re-verified here: `endSeason`'s atomic claim (`UPDATE ... WHERE status='active'`) prevents double-processing regardless of whether the manual path or the hourly `rolloverDueSeasons` cron wins the race; `computePromotionRelegation`'s `slice(-0)` bug (a real JS footgun caught by Phase 8's own tests) remains fixed and regression-tested.

## Prize recalculation / payout correctness

`computePayoutShares` (`_tournament/workflow.ts`, tested in `workflow.test.ts`, 4 cases): splits a pool according to `payout_structure` percentages, never returns a total exceeding the pool even with a rounding remainder, correctly skips a placement with no resolved winners (e.g. a 2-player tournament has no semifinal to pay), and leaves an under-100%-summing structure's shortfall unrouted for the caller to send to the platform fee account rather than silently dropping it. The Phase 8.5 hostile review additionally bounded `payoutStructure` at the API boundary (`(0,100]` per value, `<=100` summed) so an over-100% structure — which `postBalancedEntries` would reject at the ledger layer regardless — can no longer even reach that point in the normal creation flow.

## Forfeit / no-show handling

`forfeitNoShows` (`_tournament/workflow.ts`) refunds each no-show's entry fee and marks them forfeited; the Phase 8.5 performance review batched its previously-per-registrant realtime broadcast into one message per sweep. `bracket.ts`'s generators correctly exclude forfeited/never-checked-in registrations from pairing (tested).

## Draw / tie outcomes — confirmed not a supported game outcome, not a gap

Checked whether tournament matches (or the underlying Challenge engine they reuse) ever produce a draw result: they don't, by design. `_challenge/escrow-transition.ts`'s resolution path always derives a single `winner_submitted_by`; there is no "declare a draw" action anywhere in the workflow. `_ranking/service.ts`'s `updateRatingForResult` accepts a `score: 1 | 0.5 | 0` type (0.5 = draw) at the type level, matching standard Glicko notation, but nothing in this codebase ever calls it with `0.5` — every call site derives the score from `winner_submitted_by`, which is never null for a resolved match. This is consistent with the platform's actual business model (head-to-head wagering games have a winner; a "draw" has no defined payout semantics in `payout_structure`) — not an oversight to fix.

## Cancellation

`withdrawRegistration` refunds the entry fee and is only permitted before check-in begins (a state-guarded action, tested indirectly via `workflow.test.ts`'s full state-machine cross-check). Tournament-level cancellation (before bracket generation) reuses the same refund primitive as individual withdrawal, not a separate code path.

## Real gap found: suspending a player mid-tournament leaves the bracket orphaned

**Finding**: `_admin/users.ts`'s `suspendUser` correctly force-cancels and refunds any of the suspended user's in-flight challenges (`forceCancelChallenge`, reused rather than reimplemented) — and since every tournament bracket match is a real `challenges` row, a suspended player's currently-pending tournament match (still in a `FORCE_CANCELLABLE_STATUS`, i.e. before it goes live) genuinely does get refunded correctly. **What doesn't happen**: `forceCancelChallenge` has no tournament-awareness at all — it cancels the challenge but never touches `tournament_registrations` (the suspended player isn't marked forfeited) and never triggers bracket advancement for their opponent. The opponent is left waiting on a match whose challenge was cancelled out from under them, with no path to advance, and the tournament round can get stuck indefinitely.

**Not fixed this phase**: closing this gap means deciding real tournament-lifecycle business logic — should the opponent auto-advance as a bye, should the round require organizer intervention, should this differ for a double-elimination bracket's losers-bracket implications — none of which this phase's "zero feature development" mandate licenses deciding unilaterally. Flagged here as a genuine, concrete production risk for a dedicated future milestone to resolve deliberately, the same treatment given to the escrow-auto-release-on-timeout and `moderator_actions` findings elsewhere in this phase.

## Organizer ban — same class of gap, not independently re-verified

Given the finding above, a suspended *organizer*'s active (unpublished draft, or published-but-not-yet-started) tournaments likely have the same class of orphaning risk (no mechanism found that reassigns or auto-cancels an organizer's tournaments on suspension) — not independently re-derived in full detail here since it's the same underlying gap (`suspendUser` has no tournament-awareness) rather than a second, distinct one.
