# Phase 7 + 8 Performance Review

Dedicated review pass covering rate limiting, index coverage, N+1 query patterns, cron cadence, and realtime subscription load across every Phase 7/8 Edge Function and service module.

## Rate limiting

Every new/modified Phase 7/8 Edge Function passes an explicit `rateLimit` to `withEdgeFunction` — none fall through to the framework's global default, and none are reachable with zero rate limit. Sampled and confirmed for all 17: `team-manage`, `league-manage`, `ranking-manage`, `ranking-engine`, `season-rollover`, `tournament-organize`, `tournament-browse`, `tournament-scheduling-sweep`, `tournament-create`, `ai-ip-intelligence`, `ai-moderation-assistant`, `ai-reputation-engine`, `ai-fraud-scan`, `ai-trust-score`, `ai-recommendations`, `moderator-dashboard`, `admin-system-health`. Scheduled/cron-triggered functions cap the `"scheduled"` key at 5 requests/60s; interactive functions range 20-60 requests/60s depending on action cost.

**Considered and deliberately not changed**: `team-manage`/`league-manage`/`tournament-organize` apply one blanket per-user rate limit across every `?action=`, including both cheap reads and mutations — this matches the established `?view=/action` consolidated-function convention already used by `admin-wallets`/`moderator-dashboard` throughout this codebase (one function, one rate-limit budget), not a regression introduced by Phase 7/8. Splitting to per-action limits would be a broader architectural change than this review's mandate covers.

## Missing indexes — found and fixed (migration `0104`)

Three genuinely unindexed hot-path query shapes:

1. **`seasons`**: `rolloverDueSeasons()` (hourly cron) filters `status='active' AND ends_at <= now()` with no `league_id` — the only existing index (`idx_seasons_league_id_status`) leads with `league_id` and can't serve this. Added `idx_seasons_status_ends_at (status, ends_at) where ends_at is not null`.
2. **`season_participants`**: `getHistoricalStandings()` filters by `user_id`/`team_id` alone (a cross-season lookup, no `season_id` in the filter) — both existing indexes lead with `season_id`. Added `idx_season_participants_user_id`/`_team_id`.
3. **`tournaments`**: no index on `created_by` existed at all, hit by both `getOrganizerDashboard()` (every dashboard load) and `checkOrganizerScheduleConflict()` (every tournament-creation attempt). Added `idx_tournaments_created_by_game_id (created_by, game_id)`.

Every other new table (teams/team_members, leagues/divisions, player_ratings/rating_history, tournament_templates/tournament_invitations, moderation_case_suggestions, risk_scores, reputation_scores, IP-intelligence tables) was confirmed to already have indexes matching its actual query shapes.

## N+1 query patterns — found and fixed

1. **`_tournament/analytics.ts` `getTournamentEcosystemHealth`**: one `tournament_registrations` count query per tournament in the window → replaced with a single batched `.in("tournament_id", ids)` query.
2. **`_tournament/scheduling.ts` `sweepTournamentReminders`**: one `domain_events` existence check per upcoming tournament → replaced with a single lookback query (bounded to `REMINDER_WINDOW_HOURS`, provably sufficient since a tournament leaves the "upcoming" filter once it starts) building an in-memory set.

**Identified, deliberately not fixed**: `_ranking/service.ts` `sweepRatingUpdates` does up to ~20 sequential DB round-trips per `ChallengeCompleted` event (2 rating fetches × up to 2 scopes × idempotency check/update/insert, per player), up to 200 events per 10-minute run — worst case ~4,000 sequential queries per sweep. This mirrors `_ai/trust-score.ts`'s established sweep/idempotency shape exactly (a deliberate architectural convention across this codebase's cron sweeps, not an oversight specific to this module); rewriting it to a bulk-optimized form would deviate from that established, consistent pattern for a cadence (10 minutes, 200-event cap) that's already conservative. `_tournament/scheduling.ts`'s `sweepAutomaticLifecycleTransitions` has a similar per-tournament mutation loop, flagged lower-confidence since each iteration is a real state mutation, not a pure read — batching mutations safely needs more rework than this pass covers.

## Realtime subscription load — found and fixed

`forfeitNoShows` (`_tournament/workflow.ts`) broadcast one `tournament:{id}` channel message *per no-show registrant* inside its loop — could fan out into hundreds of messages from a single sweep tick for a large bracket. Fixed: the loop now performs only the per-registrant refund/DB update; a single batched broadcast with the full list of no-show user IDs is sent once, after the loop.

The other three `broadcastTournamentActivity` call sites (round completed, prize distributed, tournament completed) are each called once per tournament/round, not per-entity — confirmed no fan-out risk.

## Cron cadence

| Job | Cadence | Assessment |
|---|---|---|
| `ai-ip-intelligence` | every 6h | Matches the update frequency of its source data (TOR exit list, cloud IP ranges) — those don't change minute-to-minute. |
| `ai-reputation-engine` | every 30 min | Reasonable for a signal that informs organizer trust, not real-time decisions. |
| `ai-moderation-assistant` | every 15 min | Reasonable for an assistive (not blocking) signal. |
| `season-rollover` | hourly | Season boundaries are day/week-scale; hourly granularity is more than sufficient. |
| `ranking-engine` | every 10 min | Balances rating freshness against the sweep's per-event query cost (see N+1 note above). |
| `tournament-scheduling-sweep` | every 5 min | Tightest cadence, appropriate given it drives player-facing reminders and lifecycle transitions with real time-sensitivity. |

No cadence found mismatched to its cost.

## Validation

All fixes re-validated with the full backend pipeline (`deno fmt --check`, `deno lint`, `deno check`, `deno test`) after each change — zero regressions. See commit `ccc18ce`.
