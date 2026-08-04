# AI-001 — Explainable Statistical Intelligence Platform

**Process note**: no new phase brief was provided; scope derived from Business Rules §17 (AI Behaviour), which is explicit that this is **not** machine learning -- "purely statistical (Elo-style)... not a black-box ML model," chosen specifically so decisions stay explainable to a disputing user. Everything built here is deterministic and reproducible, not a trained model.

## 1. Architecture

Four capabilities, all reusing prior engines rather than duplicating them: trust score (Elo math + a consumer of `domain_events`), fraud detection (flag-only, reuses AUTH-001's `devices` table), opponent recommendations (a thin filter on top of CHALLENGE-001's `browseChallenges`), tournament balancing (already fully implemented by TOURNAMENT-001's `generateBracket` seeding by `trust_score` -- no new code needed here at all, just confirmed reuse).

## 2. Two schema additions, both justified

`fraud_flags` -- the API Specification's `ADMIN-EP-07` has referenced a "Fraud Flag Queue" since that document was written, but no table ever existed for it; this phase is the first to need it. `trust_score_history` -- Business Rules §13 requires the score to be "reproducible" and "explainable," which a bare current value can't provide; every adjustment is logged with the exact inputs (both ratings, K-factor) that produced it.

## 3. A real cross-phase bug caught while writing the trust-score consumer

REALTIME-001's notification dispatcher already claims `domain_events.processed_at` as its own "done" marker, including for event types it has no rule for (it marks them processed anyway to avoid retrying forever). If this phase's trust-score consumer used that same column, whichever dispatcher ran second on a given event would see it already marked processed and silently skip it -- a genuine bug, not hypothetical, caught while writing the first draft's header comment before it was ever deployed. Fixed by having the trust-score consumer never touch `processed_at` at all: it scans a rolling time window and uses its own idempotency check (does a `trust_score_history` row already exist for this challenge?) instead of a shared marker, so two independent consumers of the same event log never step on each other.

## 4. Elo Trust Score -- genuinely testable, verified before trusting it

`elo.ts` is pure math (like TOURNAMENT-001's bracket seeding) -- no DB calls at all. `elo.test.ts`'s 7 assertions were independently simulated in Python and confirmed correct *before* being committed as the Deno test (equal ratings split evenly, underdogs gain more from upsets, favorites gain almost nothing from expected wins, ratings never go negative, dispute losses are amplified 1.5x per Business Rules §13's "more heavily than a normal loss, no bonus for winning a dispute" rule).

## 5. Fraud Detection -- flag-only, verified by grep

`checkRepeatedOpponent` (Business Rules §14: soft cap on same-pair frequency) and `checkMultiAccount` (shared device fingerprint between participants, reusing AUTH-001's `devices` table directly) both only ever `INSERT` into `fraud_flags`. Verified: zero occurrences of a wallet, escrow, or challenge-status write anywhere in `fraud-detection.ts` -- matching Business Rules §17's explicit "never auto-block funds without human review in v1."

## 6. Opponent Recommendations

`recommendOpponentChallenges` calls CHALLENGE-001's `browseChallenges` for the actual query, then applies only the two filters Business Rules §17 specifically asks for: a +/-150-Elo-point trust band, and a KYC-ceiling check that reads the *same* `system_settings.kyc_pre_verification_stake_cap_cents` value AUTH-001 already defined, rather than hard-coding a second copy of that number.

## 7. Edge Functions

`ai-trust-score` (scheduled sweep, every 10 minutes), `ai-fraud-scan` (GET list / POST sweep / PATCH review, hourly schedule), `ai-recommendations` (player-facing read). All 3 follow the dual admin-or-scheduled-secret pattern established since STORE-001.

## 8. Tests

`elo.test.ts` is the one genuinely offline-testable file this phase produced, verified against an independent Python simulation before being trusted. Fraud detection and trust-score event processing touch the database immediately (same limitation REALTIME-001/MODERATOR-001 already documented) and need a live environment to test end-to-end.

## 9. Verification Checklist

- [x] Trust score math is deterministic and reproducible -- every adjustment logged with its exact inputs
- [x] Fraud detection never touches financial/challenge-state tables -- verified by grep
- [x] Tournament balancing reuses TOURNAMENT-001's existing seeding -- zero new code, confirmed rather than assumed
- [x] Opponent recommendations reuse CHALLENGE-001's query rather than re-implementing discovery
- [x] The cross-consumer `domain_events.processed_at` conflict was found and fixed, not left as a latent bug
- [x] All new files pass the full comment/string-aware bracket-balance check across the entire `supabase/functions` tree
- [x] Every cross-module import (`_ai` <-> `_challenge`/`_shared`) verified against real exports
- [x] Migration/rollback parity maintained (61/61)
- [ ] **Not verified in this environment**: no Deno runtime, no live Postgres for the DB-touching pieces -- same limitation as every prior phase. `elo.test.ts` is the exception: independently verified via Python simulation.

## Stop point

AI-001 is complete. Consistent with the established convention across this entire project, stopping here for your review.
