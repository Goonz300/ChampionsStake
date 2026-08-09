# League Platform Design (Phase 8 M3)

## 1. Architecture

A `leagues` table is a persistent, multi-season container; `divisions` are a league's permanent tier structure (`tier` integer, 1 = top division); a team/player's division *assignment* is per-season (`season_participants`, see `SEASON_PLATFORM_DESIGN.md`), since promotion/relegation moves participants between divisions each season without ever changing the division rows themselves.

## 2. Schema (migration 0095)

- `leagues` — `name, slug (unique), description, game_id, region_code, status ('active'|'archived'), created_by`
- `divisions` — `league_id, name, tier (unique per league)`

## 3. Promotion/relegation (`_league/league-heuristics.ts`)

`computePromotionRelegation(standings, promoteCount, relegateCount)` is pure and unit-tested. It ranks a division's `season_participants` by points and returns the top `promoteCount` (move up a tier) and bottom `relegateCount` (move down a tier).

**Bug found and fixed by this phase's own tests, not a later review:** `standings.slice(-relegateCount)` when `relegateCount === 0` behaves like `slice(0)` — the *whole array* — because `-0 === 0` as an array index, a genuine JavaScript footgun. A unit test asserting "zero relegations returns an empty array" caught it before commit; fixed with an explicit `relegateCount > 0` guard.

`computeSeasonPromotionRelegation` (`_league/service.ts`) is a read-only preview over this pure function — the actual move application happens inside `endSeason` (see `SEASON_PLATFORM_DESIGN.md`), kept apart so previewing promotion/relegation never accidentally commits to it.

## 4. Historical standings

`getHistoricalStandings(leagueId, participantId, participantType)` queries `season_participants` directly by `user_id`/`team_id` across every season for that league — this **is** "historical standings" (the brief's separately-named requirement), no separate history table, matching `team_members`' identical "history via non-deleted rows" pattern.

## 5. Authorization

**Hostile-review fix (see `PHASE7_8_SECURITY_REVIEW.md`, Critical #2):** league/season lifecycle actions (`create_league`, `create_division`, `start_season`, `end_season`, `archive_season`) were originally gated only by `requirePlayer` — any active account. Since `end_season` pays real money via `platformToWallet` with an attacker-controlled `rewardStructure`, this was a direct path to minting unlimited spendable balance. Fixed by requiring the `organizer` role (the same admin-granted role `tournament-create` already requires, for the identical reason) on every `league-manage` mutation. Individual functions still additionally verify `league.createdBy === actorId` for creator-scoped actions (`createDivision`, `startSeason`, `endSeason`, `archiveSeason`) — organizer role is necessary but not sufficient; you also have to own the league.

## 6. Edge Function (`league-manage`)

`?view=`/`action` consolidated function. GET: `league`, `divisions`, `seasons`, `standings`, `stats`, `historical_standings`, `promotion_relegation_preview` (all open to any player — read-only, no financial risk). POST: `create_league`, `create_division`, `start_season`, `end_season`, `archive_season` (organizer-gated, see above).

## 7. Reuse, not duplication

`recordAudit` (category `"tournament"` — leagues/seasons are part of the tournament ecosystem, not a new audit category) on every mutation; `emit()` for `LeagueCreated`/`SeasonStarted`/`SeasonEnded` into the existing notification pipeline; rate limiting via the standard `withEdgeFunction` config, not a new limiter.

## 8. Verification checklist

- [x] `slice(-0)` bug caught by a unit test before commit, fixed with an explicit guard, regression test retained
- [x] `createDivision`/`startSeason`/`endSeason`/`archiveSeason` all re-verify `league.createdBy === actorId`, not just organizer role
- [x] `league-manage` POST surface requires `requireOrganizer` post-hostile-review (was `requirePlayer`)
- [ ] **Not verified in this environment**: no live Postgres for `startSeason`'s TOCTOU race fix (migration 0105's partial unique index) — verified by reading the constraint and the 23505-handling code path, not a concurrent-request integration test.
