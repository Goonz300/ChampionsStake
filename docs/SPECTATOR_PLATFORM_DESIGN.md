# Spectator Platform Design (Phase 8 M7)

## 1. Never build another websocket system

The entire brief for this milestone reduces to one constraint, stated explicitly in the original spec and treated as load-bearing: reuse Phase 4's realtime infrastructure. Concretely, that means two existing mechanisms, extended rather than replaced:

- **Postgres Changes** (the `supabase_realtime` publication) for row-level state a client should mirror — extended in migration `0101_spectator_platform_publication.sql` to add `tournaments, tournament_registrations, season_participants, player_ratings, team_members` to the existing publication (which already covered `challenges, tournament_rounds, tournament_matches`, etc. from migration 0053).
- **Broadcast channels** (`supabase.channel(...).send({type:"broadcast", ...})`) for genuinely ephemeral signals with no backing row — mirrored from `_realtime/typing.ts`'s existing pattern.

No new channel type, no new client library, no new subscription protocol.

## 2. `broadcastTournamentActivity` (`_realtime/spectator.ts`)

```
broadcastTournamentActivity(tournamentId, event, payload) →
  channel(`tournament:${tournamentId}`).send({type:"broadcast", event, payload})
```

Called from `_tournament/workflow.ts` at genuine milestones: round completed, prize distributed, tournament completed, and (batched, see §4) no-shows recorded. `TournamentActivityEvent` is a closed union (`"no_show" | "round_completed" | "prize_distributed" | "tournament_completed" | ...`), not a free-text string, so every emitted event is enumerable and typed on both ends.

## 3. Match timeline and activity log

`getMatchTimeline(tournamentId)` and `getTournamentActivityLog(tournamentId)` read directly from `tournament_matches`/`domain_events` — no separate "activity" storage table; the durable event log (EDGE-001) already is the activity log, queried with a tournament-scoped filter.

## 4. Performance fix: batched no-show broadcasts

**Finding from the Phase 7/8 performance review**: `forfeitNoShows` (`_tournament/workflow.ts`) originally called `broadcastTournamentActivity` *inside* its per-registrant loop — one broadcast message per no-show registrant on the same `tournament:{id}` channel, which could fan out into hundreds of messages from a single sweep tick for a large bracket. Fixed: the loop now only performs the escrow refund / DB update / `TournamentNoShowRecorded` event per registrant; a single batched broadcast with the full list of no-show user IDs is sent once, after the loop.

## 5. Frontend consumption

`apps/web/lib/realtime/useRealtimeChannel.ts` (pre-existing, Phase 4) is the one hook every realtime feature funnels through. `hooks/useTournamentEvents.ts` (also pre-existing, built before this phase for `tournament_rounds`/`tournament_matches`) is reused directly by `components/tournaments/BracketView.tsx` rather than rebuilt — the component supplies its own one-time initial snapshot (via `tournament-browse?view=bracket`) since the existing hook only tracks *deltas* from the moment it subscribes, not a full initial state.

The migration-0101 publication additions (`tournaments`, `tournament_registrations`, `season_participants`, `player_ratings`, `team_members`) are not yet consumed by any live-subscribing frontend component as of this phase — the league/team pages built in the Frontend milestone are server-rendered/fetched on load, not live-subscribed. This is not a coverage gap (nothing subscribes that isn't published); it's forward capacity for a future page that wants live standings.

## 6. Verification checklist

- [x] No new websocket/channel mechanism introduced — grep confirms only `getServiceRoleClient().channel(...)` calls, the same API `_realtime/typing.ts` already used
- [x] `forfeitNoShows`'s broadcast fan-out fixed and batched
- [x] Every table `useTournamentEvents.ts` subscribes to (`tournament_rounds`, `tournament_matches`) is confirmed present in the publication
- [ ] **Not verified in this environment**: no live Postgres/Realtime server, so actual message delivery, channel fan-out under load, and the publication's row-level filtering are verified by reading the migration and call sites, not a live subscription test.
