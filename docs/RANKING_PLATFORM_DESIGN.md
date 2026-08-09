# Ranking Platform Design (Phase 8 M5)

## 1. Trust ≠ Skill — architecturally independent, by explicit instruction

`profiles.trust_score`/`trust_score_history` (Trust Engine v2, Phase 7) measures fraud/behavior risk. `player_ratings`/`rating_history` (this module) measures competitive skill. These are separate tables, separate history, separate computation, with zero shared storage — an explicit requirement, not an oversight: trust and skill answer different questions ("should we let this person play" vs. "how good are they"), and conflating them would let a skilled cheater's high rating mask fraud risk, or a struggling-but-honest new player's low rating look like a trust problem.

The one place they're *adjacent*: `generateBracket` (`_tournament/workflow.ts`) still seeds brackets from `profiles.trust_score`, unchanged from Phase 8 M1 — ranking data does not feed seeding in this phase. A future phase could switch bracket seeding to skill rating; this phase deliberately didn't, since re-deriving seeding semantics wasn't in scope.

## 2. Why Glicko-1, not Glicko-2 or Elo

Glicko-1 (Mark Glickman's original 1995 algorithm: rating + rating deviation) was chosen over Glicko-2 specifically because Glicko-2's iterative volatility-convergence step has no verifiable reference test vectors available in this sandboxed environment — implementing it without a way to check the math against a known-correct answer risks a silently wrong formula. Glicko-1 is documented as a deliberate, complete system in its own right, not a "Glicko-2 lite" substitute. It is *not* a reuse of `_ai/elo.ts`'s Elo formula (used by the Trust Engine's matchmaking heuristics) — separate math for a separate concept, consistent with §1.

## 3. Schema (migration 0098)

- `player_ratings` — `user_id, game_id, scope_type ('global'|'regional'|'season'|'tournament'), scope_id (nullable), rating, glicko_rd, matches_played, last_match_at`. Unique per `(user_id, game_id, scope_type, coalesce(scope_id,''))`.
- `rating_history` — `player_rating_id, user_id (denormalized, so idempotency queries never join through player_ratings), old/new_rating, old/new_rd, opponent_id, challenge_id, reason`.

## 4. Rating update pipeline (`_ranking/service.ts`, `_ranking/rating-heuristics.ts`)

`sweepRatingUpdates` polls `domain_events` for `ChallengeCompleted` (every 10 minutes, cron) and calls `applyChallengeResult` — the exact same event every 1v1 challenge and every tournament match emits, so tournament results reach the rating engine through identical code, with identical fraud-detection coverage (both paths are real `challenges` rows, so `_ai/fraud-detection.ts`'s `checkRepeatedOpponent`/`checkMultiAccount` see them transparently).

`applyChallengeResult` always applies a **global**-scope update. When `challenges.tournament_id` is set (a tournament match), it *also* applies a **tournament**-scoped update for the same result — a cross-system integration fix (see `PHASE7_8_SECURITY_REVIEW.md`'s companion doc `PHASE7_8_MIGRATION_SUMMARY.md`): the schema supported `scope_type='tournament'`/`'season'` from the start, but nothing populated it until this fix, so tournament/season leaderboards were previously permanently empty. **Season-scoped ratings remain unpopulated** — tournaments have no `season_id`/`league_id` linkage in the schema (the League/Season Platform tracks standings via `season_participants` directly, independently of tournaments), so there is no reliable mapping from a challenge to a season to derive one from.

Idempotency is checked per `(player_rating_id, challenge_id)` — i.e. per scope — inside `updateRatingForResult`, not once per challenge before any scope runs. This means a sweep retry after a partial failure (global update succeeded, tournament update threw) reprocesses only the missing scope, not the whole event.

## 5. Rating decay and placement

`computeRatingDecay(rd, daysSinceLastMatch)` widens (increases uncertainty in) a dormant player's RD, capped at 350 — an inactive player's rating becomes less certain over time, matching Glicko's actual design intent (an RD-350 player's next result swings their rating much further than an RD-50 player's). `isInPlacement(matchesPlayed)` — true for the first 5 matches.

## 6. `scope_id` NULL handling

`filterByScopeId` uses `.is("scope_id", null)` for the global-scope case rather than `.eq("scope_id", "")` — a real bug this phase caught in its own review: PostgREST's `.eq(col, "")` generates `col = ''`, which SQL's three-valued logic never matches against a genuine `NULL` column, so global-scope leaderboard queries would have silently returned empty rows.

## 7. Leaderboards

`getLeaderboard(gameId, scopeType, scopeId)` — straight `order by rating desc`. `ranking-manage` Edge Function exposes this via `?view=leaderboard`, consumed by `apps/web/app/(app)/leaderboards/page.tsx`.

## 8. Verification checklist

- [x] Zero shared tables/columns between trust score and player rating
- [x] Tournament matches update both global- and tournament-scoped ratings, verified by reading `applyChallengeResult`'s scope loop
- [x] Idempotency re-verified as per-scope after the cross-system integration fix (previously per-challenge, which would have silently skipped the tournament-scope update on a partial-failure retry)
- [x] `filterByScopeId`'s NULL-vs-empty-string distinction, unit-tested indirectly via `rating-heuristics.test.ts`'s pure-function coverage
- [ ] **Not verified in this environment**: no live Postgres for the actual sweep execution, the `player_ratings` upsert race (insert-then-catch-23505 pattern), or a real Glicko convergence sequence across many matches — `computeGlickoUpdate`/`computeRatingDecay` are unit-tested as pure functions (10 test cases), the surrounding DB orchestration is not.
