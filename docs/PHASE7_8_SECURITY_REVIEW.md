# Phase 7 + 8 Security Review

Independent hostile review of Phase 7 (AI Intelligence: Trust/Risk/Reputation/Fraud/Matchmaking/Recommendations/Moderation/Analytics) and Phase 8 (Tournament Ecosystem: Team/League/Season/Ranking/Organizer/Spectator/Scheduling), conducted as a dedicated review pass separate from each milestone's own implementation. Method: an agent instructed to assume every line was written by another team, find genuine exploitable defects with a concrete attack sequence and impact, and refuse to report anything it couldn't articulate a real exploit for. Every finding below was independently verified by direct code reading (exact file:line, exact query/check logic) before being fixed.

## Findings and resolutions

### CRITICAL — Team ownership takeover (`_team/service.ts` `transferOwnership`)

**Defect**: the ownership-transfer transaction's row-locked claim query verified only that the caller (`currentOwnerId`, taken directly from the caller's own JWT via `team-manage/index.ts`) was an **active member** of the team — never that they held `role = 'owner'`.

**Attack**: any regular team member calls `POST team-manage {action:"transfer_ownership", teamId, newOwnerId: <own alt account, already a member>}`. The function promotes the caller to `captain` and the target to `owner`, overwriting `teams.owner_id`, with no verification the caller ever held ownership. `removeMember` then refuses to remove `role='owner'` rows, so the legitimate owner cannot even clean this up through the API.

**Impact**: full team hijack by any member; since season rewards for team-based standings pay `teams.owner_id`'s wallet (`getTeamOwnerWalletId`), this was also a route to silently redirect a team's future reward payouts.

**Fix**: added `and role = 'owner'` to the locked claim query. Commit `d0a3ae9`.

### CRITICAL — Unbounded season-reward minting (`league-manage`, `_league/season-service.ts`)

**Defect**: `create_league`, `start_season`, and `end_season` were gated only by `requirePlayer` (any active account) — not the `organizer` role `tournament-create` already requires for the identical real-money reason. `rewardStructure` (a POST body field on `start_season`) had no upper bound. `endSeason` pays computed rewards via `platformToWallet`, which debits an uncapped `platform_clearing` account directly into the recipient's spendable balance with **no admin approval** — unlike `administrativeAdjustment`'s documented four-eyes (`approvedByAdminIds: [string, string]`) requirement.

**Attack**, 4 API calls, zero privilege required: create a league → create a division → start a season as its sole participant with `rewardStructure: {"1": 999999999}` → end the season. `endSeason` pays the full attacker-chosen amount with no cap and no second approver.

**Impact**: unlimited real spendable balance created, withdrawable through the (trusted) wallet pipeline. The single most severe finding in the review.

**Fix**: `league-manage`'s POST handler now requires the `organizer` role (`requireOrganizer`) before any mutation, matching `tournament-create`/`tournament-organize`'s existing gate. Commit `d0a3ae9`.

### HIGH — Reputation farming via trivial tournaments (`_ai/reputation-heuristics.ts`)

**Defect**: `completedBonus` (40 of the 100-point `computeTournamentReputationScore` scale) applied in full to *any* tournament that merely reached `status='completed'`, with no minimum participant count or entry fee. The cheapest legal tournament (2 players — the platform minimum — zero entry fee) scored identically to a large, real one.

**Attack**: an organizer (or organizer + a colluding alt/friend) runs several trivial free 2-player tournaments to drive `computeOrganizerReputation` to ~100 with zero real stakes or competition, manufacturing a "trusted organizer" signal cheaply before a real, higher-stakes event.

**Impact**: a gameable trust signal surfaced to players deciding whether to enter a paid tournament.

**Fix**: added `computeTournamentScaleFactor(registrationCount)` — a diminishing-returns (log2) scale, same shape as the existing `computeExperienceFactor` — applied to `completedBonus` before scoring. A 2-player bracket now earns roughly half credit; an 8-or-larger field earns full credit. Regression tests added in `reputation-heuristics.test.ts`. Commit `d0a3ae9`.

### MEDIUM — `payoutStructure` unvalidated (`tournament-organize` `create_template`)

**Defect**: `payoutStructure` percentages had no bounds. `computePayoutShares` multiplies `totalPoolCents * percent / 100`; an out-of-range structure (e.g. `{"1": 100000}`) doesn't enable theft — `postBalancedEntries` hard-rejects any unbalanced ledger request — but it permanently sticks the tournament in `prize_distribution` with every registrant's entry fee locked in escrow (a self-inflicted DoS on that tournament).

**Fix**: bounded each `payoutStructure` value to `(0, 100]` and the sum to `<= 100` via a zod `.refine()`. Commit `d0a3ae9`.

### MEDIUM — Replay gap in `spawn_from_template` (`tournament-organize`)

**Defect**: unlike `tournament-register`'s established `Idempotency-Key` pattern, `spawn_from_template` had no replay protection — a retried/double-clicked request created two independent draft tournaments from the same template, each independently opening registration and collecting entry fees.

**Fix**: added the same `beginIdempotentRequest`/`completeIdempotentRequest`/`failIdempotentRequest` flow used by `tournament-register`. Commit `d0a3ae9`.

**Accepted, not fixed**: `createTeam`, `createLeague`, and `createTemplate` have the same theoretical replay gap but move no money and create no exploitable advantage (a duplicate team/league/template row is data hygiene, not a security issue) — out of scope for this pass given no articulable attacker gain; `spawn_from_template` was fixed because it's the one with a real money-adjacent consequence (duplicate entry-fee collection).

### LOW — `startSeason` TOCTOU race (`_league/season-service.ts`)

**Defect**: the "does this league already have an active season" check was a plain `SELECT` with no lock, racing an unguarded `INSERT`. Two concurrent `start_season` calls for the same league could both pass the check and both insert an active season.

**Impact**: a data-integrity glitch (two simultaneous "active" seasons for one league), not a fund-duplication path — each season's own reward payout remains independently atomic-claimed.

**Fix**: added `uq_seasons_one_active_per_league`, a partial unique index (migration `0105`), so the losing concurrent insert fails cleanly with `23505` (translated to a `ConflictError`) instead of silently succeeding. Commit `d0a3ae9`.

## Findings investigated and confirmed NOT exploitable

- **Rating manipulation via self-play/collusion**: tournament matches are real `challenges` rows resolved through the identical `ChallengeCompleted` event and `applyChallengeResult` path as 1v1 challenges — same fraud-detection coverage (`checkRepeatedOpponent`/`checkMultiAccount` scan tournament matches transparently), no separate/weaker check for the tournament path.
- **Bracket/seed/bye manipulation**: `generateBracket` derives seed strictly from server-held `profiles.trust_score`; no request parameter in `tournament-organize` or `tournament-register` reaches bracket placement.
- **Team/league privilege escalation elsewhere**: `removeMember`, `promoteToCaptain`, `createDivision`, `endSeason`, `archiveSeason` were all confirmed to independently re-verify the caller's actual role/ownership against the database (not a client-supplied role parameter) — `transferOwnership` (fixed above) was the one exception in these modules.
- **Season rollover double-issuance**: the rollover cron and a manual `end_season` call both go through the same atomic `UPDATE … WHERE status='active'` claim — cannot double-process the same season.

## Root-cause pattern across the two Critical findings

Both Critical findings share a shape: a new Phase 8 write path reused an *existing, safe-looking primitive* (`platformToWallet`, a row-locked membership check) without re-deriving whether that primitive's original authorization assumptions still held in the new context. `platformToWallet` is safe when only trusted, already-role-gated code paths call it (promotional bonuses); it becomes a minting bug the moment a caller can reach it through their own choice of amount with no role gate above it. The general lesson applied going forward in this codebase: reusing a financial primitive is not the same as reusing its authorization boundary — each new call site needs its own explicit role/ownership check, not an inherited assumption from the primitive's other callers.

## Full validation

Every fix passed the complete backend validation pipeline (`deno fmt --check`, `deno lint`, `deno check`, `deno test` — 208 tests passed, 0 failed) before commit. See `PHASE7_8_FINAL_PRODUCTION_REPORT.md` for the consolidated gate status.
