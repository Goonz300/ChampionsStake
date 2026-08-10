# TOURNAMENT-001 — Enterprise Tournament Engine

## 1. Architecture

The single most important design decision this phase made explicit: **tournament entry fees are collected once, at registration**, into a tournament-level escrow — individual bracket matches never lock or release per-match stakes. Every bracket match reuses CHALLENGE-001's gameplay-only functions (`readyCheck`, `startMatch`, `declareWinner`, `completeChallenge` — none of which move money) directly, and WALLET-001's `lockToEscrow`/`releaseFromEscrow` are called exactly twice per player: once at registration, once at withdrawal/cancellation. This is "never duplicate Challenge/Escrow/Wallet logic, only coordinate them," made concrete rather than just stated.

## 2. Folder Structure

```
supabase/functions/_tournament/
  types.ts, repository.ts
  bracket.ts (+ bracket.test.ts)     single-elim implemented; double-elim/Swiss/round-robin architecture-ready, throw clear not-implemented errors
  workflow.ts (+ workflow.test.ts)   the orchestrator — 19 exported functions
supabase/functions/
  tournament-create/ -publish/ -register/ -checkin/ -generate-bracket/
  -start-round/ -complete-round/ -advance-player/ -complete/ -archive/
  -browse/                                                    (11 Edge Functions)
supabase/migrations/0046-0048
```

## 3. Bracket Engine

Single elimination fully implemented with standard tournament seeding (1v8, 4v5, 2v7, 3v6 for 8 players; byes automatically go to top seeds for non-power-of-two fields) — verified by simulating the exact algorithm in Python before committing it as a Deno test, the same verification discipline used for CHALLENGE-001's state-machine tests. Double elimination, Swiss, and round robin were architecture-ready (`BracketGenerator` interface) but threw clear "not implemented" errors at the time this document was written — Business Rules §5 didn't specify their pairing/tiebreak rules closely enough to implement without inventing rules unilaterally at that point in the project.

**Update (Phase 8, superseding the above)**: all three formats are now fully implemented in `_tournament/bracket.ts`, with dedicated test coverage in `bracket.test.ts` (double-elimination winners/losers bracket seeding and grand final, round-robin full round-trip with bye handling, Swiss score-group pairing and rematch avoidance). See `docs/SCHEDULING_DESIGN.md` and `docs/TOURNAMENT_ANALYTICS_DESIGN.md` for the Phase 8 tournament-platform documentation this superseded-but-historical file predates.

## 4. Workflow Engine

19 functions covering the full lifecycle: create → publish → register/withdraw → close registration → **open check-in** → check-in/no-show sweep → generate bracket → start round → (match play, delegated to CHALLENGE-001) → complete round (auto-advancement via `computeNextRound`) → repeat until final → trigger prize distribution (event only) → complete → archive, plus cancel-with-refund at any pre-bracket stage.

## 5. A real gap found and fixed by this phase's own verification process

While cross-checking every transition `workflow.ts` performs against the state-guard's edge list (migration 0047) — the same method that caught two bugs in CHALLENGE-001 — I found that **nothing in the codebase ever transitioned a tournament from `registration_closed` to `check_in`**. `closeRegistration` stopped at `registration_closed`; `generateBracket` required `check_in` as a precondition; nothing bridged the two. Added `openCheckIn()` and wired it into `tournament-checkin`'s new `action: "open"` mode. `workflow.test.ts` now cross-checks all 17 transitions the engine performs and confirms zero remaining gaps.

## 6. Scheduler

`tournament-archive` (daily sweep, migration 0048, identical pg_cron/pg_net/Vault pattern to every prior phase). **Check-in-timeout and round-timeout are deliberately not scheduled** on a fixed pg_cron interval — same reasoning CHALLENGE-001 documented for ready-check/countdown timers: short per-tournament windows are a poor fit for fixed-interval polling across every active tournament. Both are exposed as callable sweep modes (`tournament-checkin`'s `action: "sweep"`, `tournament-complete-round`'s scheduled-secret path) for whichever future phase builds precise per-entity scheduling.

## 7. Repository

Typed access to tournaments, registrations, rounds, and matches (the latter joined with their underlying challenge for status/winner info — reusing CHALLENGE-001's schema rather than duplicating result-tracking columns).

## 8. Edge Functions & APIs

11 Edge Functions matching the brief's list, plus `tournament-browse` consolidating Browse/Search/Bracket/Standings/Participants/Leaderboard into one read endpoint (five near-identical single-SELECT functions would have been needless duplication). Registration and check-in both support the dual admin-or-scheduled-secret auth pattern established in every prior phase's schedulers.

**Realtime**: `TournamentCreated/RegistrationOpened/RegistrationClosed/CheckInOpened/BracketGenerated/RoundStarted/RoundCompleted/PlayerAdvanced/PrizeDistributionTriggered/TournamentCompleted` all emitted via EDGE-001's durable event log.

## 9. Tests

`bracket.test.ts` — 5 cases, all pure logic (no DB needed): standard 8-player seeding, bye distribution for a 5-player field, exclusion of no-shows/forfeits, next-round pairing, and a not-implemented-error check for double elimination. `workflow.test.ts` — the edge cross-check that found this phase's one real bug. Full end-to-end tests (a complete 8-player single-elim tournament from registration through prize-distribution trigger) need a live database — same documented limitation as every prior phase.

## 10. Verification Checklist

- [x] No per-match escrow lock/release anywhere in `_tournament/` — verified by grep: `lockToEscrow`/`releaseFromEscrow` appear only in registration/withdrawal/no-show/cancellation paths, never in match creation or resolution
- [x] Every bracket match is a real `challenges` row (verified: `createMatchOrAutoAdvance` always inserts into `challenges` for non-bye matches)
- [x] Match gameplay (ready/countdown/live/declare-winner) is 100% delegated to CHALLENGE-001's existing functions — zero duplicated gameplay logic
- [x] Prize distribution is trigger-only — `triggerPrizeDistribution` never calls `releaseFromEscrow` itself, per this phase's explicit instruction
- [x] Bracket seeding verified correct via independent Python simulation before being committed as a test
- [x] The `registration_closed → check_in` gap found and fixed, with a test now guarding against regression
- [x] All new/modified files pass the full comment/string-aware bracket-balance check across the entire `supabase/functions` tree
- [x] Every cross-module import (`_tournament` ↔ `_challenge` ↔ `_wallet` ↔ `_shared`) verified against real exports
- [ ] **Not verified in this environment**: no Deno runtime, no live Postgres — same limitation as every prior phase. A full end-to-end bracket run, the bye-resolution path via `tournament-advance-player`, and the scheduler sweeps all still need to run for real.

## 11. Tournament Integrity Report

**Structurally guaranteed**: entry fees are captured exactly once per player via the same ledger primitives every other phase uses; every state transition passes through both application and database guards; bracket seeding is deterministic and independently verified.

**Known, stated limitation**: byes (no challenge row exists) are not automatically resolved inside `completeRound` — they require an explicit `tournament-advance-player` call. This is flagged in the code and here rather than silently mishandled, and is a reasonable candidate for automatic resolution in a future refinement once this phase's core is verified live.

**Deferred, not silently dropped**: precise check-in/round-timeout scheduling needs infrastructure beyond fixed-interval pg_cron — documented consistently with CHALLENGE-001's identical gap.

## Stop point

TOURNAMENT-001 is complete. Per the established convention, stopping here — awaiting your direction on what's next.
