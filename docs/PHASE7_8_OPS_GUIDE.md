# Phase 7 + 8 Operations Guide

## Scheduled jobs to monitor

| Job | Cadence | Failure symptom if broken |
|---|---|---|
| `ai-ip-intelligence` | every 6h | IP risk scores go stale; new VPN/TOR exits not flagged |
| `ai-reputation-engine` | every 30 min | Organizer/tournament reputation scores stop updating |
| `ai-moderation-assistant` | every 15 min | Moderation queue loses its risk-informed tie-break signal (queue still functions on `disputes.priority` alone) |
| `season-rollover` | hourly | Seasons past `ends_at` never auto-complete; rewards/promotion-relegation never apply until manually triggered |
| `ranking-engine` | every 10 min | Leaderboards go stale; new matches don't move ratings |
| `tournament-scheduling-sweep` | every 5 min | Draft tournaments never auto-publish; reminders stop going out; underfilled tournaments never auto-reschedule |

All six use the established `pg_cron` + `pg_net.http_post` + Vault-stored secret pattern (identical to every scheduler since migration 0061). If a job stops running, check: (1) the `cron.job` table for the schedule still being registered, (2) the Vault secret hasn't rotated without updating the cron job's stored reference, (3) `pg_net`'s HTTP response log for the Edge Function's actual error.

## What "stuck" looks like and how to unstick it

- **A tournament stuck in `prize_distribution`**: almost certainly an unbalanced `payoutStructure` (pre-hostile-review-fix bug class; the fix bounds new templates, but a tournament created from an already-existing bad template before the fix could still be stuck). Check `postBalancedEntries`' rejection reason in the Edge Function logs; the fix is a manual `payout_structure` correction on that tournament row, then re-trigger `triggerPrizeDistribution`.
- **A season stuck in `active` past its `ends_at`**: check the `season-rollover` cron is actually firing (see above); `endSeason` can also be called manually via `league-manage {action:"end_season"}` by the league's organizer.
- **`league-manage`/`tournament-organize` 403s for a user who should have access**: confirm the account actually holds the `organizer` role (`profiles.role`) — this is admin-granted, not self-service, by design (see `ORGANIZER_PLATFORM_DESIGN.md` §1 and the hostile-review fix in `PHASE7_8_SECURITY_REVIEW.md`). Granting it is an `admin-users`-style role update, not a new endpoint.

## Monitoring the hostile-review fixes specifically

- **Team ownership transfers**: `audit_logs` category `"team"`, action `TeamOwnershipTransferred` — every transfer is logged with `actorId` and `newOwnerId`. A transfer where `actorId` doesn't match the team's `owner_id` immediately prior would indicate the pre-fix bug recurring (shouldn't be possible post-fix, but is the concrete thing to alert on if it ever is).
- **Season reward payouts**: `audit_logs` category `"tournament"`, action `SeasonEnded`, `metadata.rewardsIssued` — review for any amount far outside the platform's normal reward ranges. Since `league-manage` now requires the `organizer` role, the attack surface is limited to admin-vetted accounts, but reward amounts are still uncapped in code (see `PHASE7_8_SECURITY_REVIEW.md`'s Critical #2 fix rationale) — this is intentionally a trust-the-organizer-role boundary, not a code-level cap, so an anomalous amount from a legitimately organizer-role account is an ops/trust review question, not a bug.

## Realtime channels

Subscribe pattern for support/ops debugging: `tournament:{tournamentId}` (broadcast events: `no_show` (batched, `userIds[]`), `round_completed`, `prize_distributed`, `tournament_completed`). Postgres Changes on `tournaments, tournament_registrations, season_participants, player_ratings, team_members` (migration 0101) plus the pre-existing `tournament_rounds, tournament_matches` (migration 0053).

## Rate limit reference

See `PHASE7_8_PERFORMANCE_REVIEW.md`'s rate-limiting table for every function's exact key/window/max. A `429` from any Phase 7/8 endpoint is expected behavior, not an incident, unless the reported key/window doesn't match that table.
