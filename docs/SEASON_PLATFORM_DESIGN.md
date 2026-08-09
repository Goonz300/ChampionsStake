# Season Platform Design (Phase 8 M4)

(Referenced from `_league/season-service.ts` before this file existed — this is that promised design doc.)

## 1. Architecture

A season is a time-boxed period within a league (`status: 'upcoming'|'active'|'completed'|'archived'`). Ending a season is a distinct, explicit step from starting the next one (`startSeason`, separately called and seeded with the prior season's promotion/relegation results) — deliberately not auto-chained, so ending a season is never silently coupled to committing to a specific next-season shape.

## 2. Schema (migration 0095)

- `seasons` — `league_id, name, status, starts_at, ends_at, archived_at, reward_structure (jsonb)`
- `season_participants` — `season_id, division_id, user_id | team_id (exactly one, enforced by a check constraint), wins, losses, draws, points`. This table **is** season standings, queried directly — no separate standings table.

## 3. Lifecycle (`_league/season-service.ts`)

`startSeason` → `endSeason` → `archiveSeason`. All three use the atomic-claim pattern (`UPDATE … WHERE status = 'X' RETURNING *`) established by Phase 6's `approveHeldWithdrawal`/`rejectHeldWithdrawal` — two concurrent `end_season` calls (e.g. a manual action racing the scheduled rollover sweep) cannot both apply rewards, because only one can win the `WHERE status = 'active'` claim.

`endSeason(actorId: string | null, seasonId)` accepts a nullable `actorId` deliberately: the automatic rollover sweep (`rolloverDueSeasons`, cron-triggered) has no human actor to check ownership against, so `actorId === null` is treated as the system-actor case and skips the creator check; a real (human-triggered) call still requires `league.createdBy === actorId`.

## 4. Rewards

`computeSeasonRewards(rankedParticipantIds, rewardStructure)` (`_league/league-heuristics.ts`, pure, unit-tested) maps ranked standings to `reward_structure`'s placement keys. Payout uses the existing single-actor `platformToWallet` primitive (`_wallet/transfer.ts`) — the same tier as promotional bonuses, not the four-eyes `administrativeAdjustment` flow, since a season reward is a normal expected platform benefit, not a corrective adjustment. Team-based standings pay the team's *current owner* (`getTeamOwnerWalletId`) — no team-owned wallet exists (see `TEAM_PLATFORM_DESIGN.md` §7).

## 5. Rollover scheduler

`season-rollover` Edge Function, hourly `pg_cron` (migration 0097), calls `rolloverDueSeasons()` → finds seasons with `status='active' and ends_at <= now()` → calls the same `endSeason` as a manual action would, with `actorId = null`. Because `endSeason`'s status claim is atomic, this cannot double-process a season a human already ended manually, and vice versa.

## 6. Domain events

`SeasonStarted`/`SeasonEnded` — `SeasonEnded` is its own event type, not a reuse of `TournamentCompleted` (a "mislabeled emit()" anti-pattern this codebase's own hostile-review conventions explicitly watch for — reusing an existing event type for a semantically different event, distinguished only by an unread payload field, has caused real bugs in earlier phases). `SeasonEnded` was initially missing from `_realtime/notifications.ts`'s `EVENT_RULES` map (found in the Phase 7/8 cross-system integration audit) — fixed, see `PHASE7_8_SECURITY_REVIEW.md`.

## 7. Security fixes from the hostile review

Two Critical/Low findings in this module, both fixed — see `PHASE7_8_SECURITY_REVIEW.md`:
- **Critical**: `league-manage`'s entire POST surface (including `start_season`/`end_season`) was gated only by `requirePlayer`, making unbounded reward minting self-service for any account. Fixed by requiring the `organizer` role.
- **Low**: `startSeason`'s "does this league already have an active season" check was a plain SELECT racing an unguarded INSERT (TOCTOU). Fixed with a partial unique index (migration 0105, `uq_seasons_one_active_per_league`) plus a 23505-to-`ConflictError` translation.

## 8. Verification checklist

- [x] `endSeason` is atomically claimed — cannot double-issue rewards even under concurrent manual + scheduled calls
- [x] `startSeason` cannot create two active seasons for the same league (post-fix, DB-enforced)
- [x] `SeasonEnded` is a distinct event type, not a reused one
- [x] `SeasonEnded` now has an `EVENT_RULES` entry (participants + team owners notified)
- [ ] **Not verified in this environment**: no live Postgres for the rollover sweep's actual cron execution or the reward-payout wallet crediting — verified by code reading against `_wallet/ledger.ts`'s balance-check logic, not a live run.
