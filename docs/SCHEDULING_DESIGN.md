# Tournament Scheduling Design (Phase 8 M9)

## 1. Scope

Timezone awareness, organizer availability-window conflict detection, automatic lifecycle transitions (publish/close-registration/open-check-in when underfilled or on schedule), reminder generation, an iCalendar export feed, and scheduling-adherence analytics — all in `_tournament/scheduling.ts` / `_tournament/scheduling-heuristics.ts`.

## 2. Heuristics (pure, unit-tested)

- `windowsOverlap(a, b)` — symmetric interval overlap check; touching endpoints are *not* a conflict (a tournament ending exactly when another starts is legal).
- `findScheduleConflict(candidate, existingWindows)` — first overlapping window, or null.
- `formatInTimezone(date, timezoneName)` — falls back to UTC for an invalid/null IANA zone rather than throwing, since a bad timezone string should degrade gracefully, not crash a schedule check.
- `generateIcsEvent` / `wrapIcsCalendar` — RFC 5545 VEVENT/VCALENDAR generation as plain text. This is a genuine "calendar integration layer": no external calendar-provider API is needed or used, since iCalendar is a self-contained text format any calendar app can import directly.

## 3. Conflict detection

`checkOrganizerScheduleConflict(organizerId, gameId, window, excludeTournamentId)` — queries the organizer's own other tournaments for the same game with an overlapping registration/start window, using `findScheduleConflict`. Runs on every tournament-creation attempt via `tournament-organize`'s `schedule_conflict` view.

## 4. Automatic lifecycle sweep (`sweepAutomaticLifecycleTransitions`, every 5 minutes)

Three independent checks per sweep tick: publish a due draft, close registration when its window has passed, open check-in when its window has passed. Each iterates matching tournaments and calls the corresponding `workflow.ts` state-transition function — not batched, since each iteration is a real state mutation (not a pure read), and batching a mutation loop safely would need more rework than this pass's scope covers; flagged by the performance review as a lower-confidence, accepted-as-is finding for that reason.

## 5. Reminder generation

`sweepTournamentReminders` (every 5 minutes, same sweep function) finds tournaments starting within `REMINDER_WINDOW_HOURS` (24h) and emits `TournamentReminderDue` once per tournament, reusing the *existing* notification pipeline (`emit()`/`EVENT_RULES`/`processUnhandledEvents`) rather than a second notification mechanism. Idempotency: checks `domain_events` for a prior `TournamentReminderDue` for that tournament, rather than a new tracking column.

**Performance fix**: this idempotency check originally issued one `domain_events` existence query *per upcoming tournament* (N+1). Fixed: a single query fetches all `TournamentReminderDue` events from the last `REMINDER_WINDOW_HOURS` (sufficient lookback, since a tournament leaves the "upcoming" filter once it starts or its status advances past check-in, so no reminder for it could exist outside that window) and builds an in-memory set, checked once per tournament in the loop instead of querying per tournament.

## 6. Auto-reschedule when underfilled

`autoRescheduleIfUnderfilled(tournamentId)` — if a tournament is below its minimum participant threshold as its start time approaches, pushes `starts_at` back rather than starting an unplayable bracket. Exposed via `tournament-organize`'s `reschedule_if_underfilled` action, owner-or-admin gated.

## 7. Calendar feed

`getTournamentIcsFeed(tournamentId)` generates a `.ics` file on demand from `tournaments.name/starts_at/registration_closes_at` — served through `tournament-browse`'s `?view=ics`, proxied by `apps/web/app/api/tournaments/route.ts` (special-cased to return the raw ICS text rather than JSON).

## 8. Verification checklist

- [x] `windowsOverlap`/`findScheduleConflict` — 6 unit tests, including the touching-endpoints-is-not-a-conflict case
- [x] `formatInTimezone` — 3 unit tests, including invalid-zone and null-zone fallback
- [x] `generateIcsEvent`/`wrapIcsCalendar` — shape-validated by unit test against the RFC 5545 VEVENT/VCALENDAR structure
- [x] Reminder sweep's N+1 query pattern fixed and re-validated
- [ ] **Accepted, not fixed**: `sweepAutomaticLifecycleTransitions`'s three per-tournament mutation loops remain unbatched (see §4) — a deliberate scope decision given the review's severity classification (Low-confidence finding, mutation batching risk outweighs the performance gain at expected sweep volume).
- [ ] **Not verified in this environment**: no live `pg_cron`/Postgres, so actual sweep-tick timing and the ICS feed's real-world calendar-app compatibility are unverified beyond the pure-function unit tests.
