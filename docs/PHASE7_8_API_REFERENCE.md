# Phase 7 + 8 API Reference

New and modified Supabase Edge Functions. All follow the established `withEdgeFunction` composition (auth, rate limiting, logging, error handling) and the `?view=`/`action` consolidated-function convention where a domain has multiple read views or write actions — one function per domain, not one function per operation.

## AI Intelligence (Phase 7)

| Function | Method(s) | Auth | Purpose |
|---|---|---|---|
| `ai-trust-score` | POST | scheduled secret or admin | Sweeps trust-score-affecting events (withdrawal settled/reversed, tournament no-show, chargeback, sanctions block) |
| `ai-fraud-scan` | POST | scheduled secret or admin | Sweeps for fraud signals (device farming, velocity, multi-account) |
| `ai-ip-intelligence` | POST | scheduled secret or admin | Refreshes TOR/datacenter IP ranges, backfills IP risk on recent sessions |
| `ai-reputation-engine` | POST | scheduled secret or admin | Sweeps player/moderator/tournament/organizer reputation scores |
| `ai-moderation-assistant` | POST | scheduled secret or admin | Generates risk-informed dispute-priority suggestions (assistive only — never writes `disputes.priority`) |
| `ai-recommendations` | GET | player | `?type=opponents\|matchmaking\|friends\|tournaments` |

## Tournament Platform (Phase 8)

| Function | Method(s) | Auth | Views / Actions |
|---|---|---|---|
| `tournament-create` | POST | organizer or administrator | Create a tournament (widened from admin-only in this phase) |
| `tournament-browse` | GET | player (visibility-filtered) | `?view=list\|detail\|bracket\|standings\|leaderboard\|match_timeline\|activity\|ics` |
| `tournament-organize` | GET/POST | organizer (+ any player for `respond_invitation`) | GET: `dashboard, participation, revenue, drop_off, quality, ecosystem_health, scheduling_adherence, schedule_conflict`. POST: `create_template, spawn_from_template` (idempotency-keyed), `invite, respond_invitation, reschedule_if_underfilled` |
| `tournament-scheduling-sweep` | POST | scheduled secret or admin | Automatic lifecycle transitions + reminder generation (every 5 min) |

## Team Platform (Phase 8 M2)

| Function | Method(s) | Auth | Views / Actions |
|---|---|---|---|
| `team-manage` | GET/POST | player | GET: `team, members, stats, my_invitations`. POST: `create, invite, respond_invitation, revoke_invitation, leave, remove_member, transfer_ownership, promote_captain` |

## League / Season Platform (Phase 8 M3/M4)

| Function | Method(s) | Auth | Views / Actions |
|---|---|---|---|
| `league-manage` | GET/POST | player (GET) / **organizer** (POST, post-hostile-review) | GET: `league, divisions, seasons, standings, stats, historical_standings, promotion_relegation_preview`. POST: `create_league, create_division, start_season, end_season, archive_season` |
| `season-rollover` | POST | scheduled secret or admin | Ends seasons past `ends_at` (hourly) |

## Ranking Platform (Phase 8 M5)

| Function | Method(s) | Auth | Views / Actions |
|---|---|---|---|
| `ranking-manage` | GET | player | `?view=leaderboard\|rating\|history` — `scopeType=global\|regional\|season\|tournament` |
| `ranking-engine` | POST | scheduled secret or admin | Sweeps `ChallengeCompleted` events into Glicko rating updates (every 10 min) |

## Idempotency-keyed mutations

Every mutation that moves money or creates a resource retriable-with-consequence requires an `Idempotency-Key: <uuid>` header: `tournament-register` (pre-existing), `tournament-organize`'s `spawn_from_template` (added this phase, post-hostile-review).

## Internal Next.js proxy routes (`apps/web/app/api/**`)

All authenticated client-side calls to the above functions proxy through an internal route using `invokeEdgeFunctionAsUser` (forwards the caller's own JWT, never the service-role key):

| Route | Proxies |
|---|---|
| `/api/tournaments` | `tournament-browse` (GET, including the raw-text `?view=ics` response), `tournament-create` (POST) |
| `/api/tournaments/organize` | `tournament-organize` (GET/POST) |
| `/api/tournaments/register` | `tournament-register` (POST, generates `Idempotency-Key` server-side) |
| `/api/teams` | `team-manage` (GET/POST) |
| `/api/leagues` | `league-manage` (GET/POST) |
| `/api/rankings` | `ranking-manage` (GET) |
