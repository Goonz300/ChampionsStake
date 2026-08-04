# Realtime Platform — Test Plan

Unlike TOURNAMENT-001's bracket engine, almost none of this phase's logic is
pure computation -- chat, presence, and notification dispatch all touch the
database immediately, so there is no meaningful offline unit-test surface
here (a mocked Supabase client would just be asserting the mock, not the
logic). Every test below needs a live Supabase project with Realtime
enabled; specified precisely enough to implement directly.

## Chat tests
1. Sending a message before `escrow_locked` is rejected (chat doesn't exist yet).
2. Sending a message after the challenge reaches `completed` is rejected (read-only trigger).
3. Editing within 5 minutes succeeds and preserves `original_content`; editing after 5 minutes is rejected.
4. Deleting sets a tombstone (`deleted_at`, null content/media) and preserves `original_content`.
5. A media message with a `fileUploadId` belonging to a DIFFERENT challenge is rejected.
6. A media message referencing another user's upload is rejected.

## Presence tests
7. `updatePresence` never accepts a client-supplied `user_id` -- verify the Edge Function always uses `ctx.user.id`, never a body field.
8. `sweepStalePresence` marks a user offline after `last_seen_at` exceeds 2 minutes, and does NOT touch already-offline users (no-op idempotence).

## Notification tests
9. `processUnhandledEvents` is idempotent -- running it twice in a row does not double-notify (every processed event gets `processed_at` set before the next run).
10. A user with `challenge_updates.push = false` in `user_preferences` receives no notification for `ChallengeCreated`, but a `DisputeOpened` notification (different preference key) still arrives.
11. An event type with no `EVENT_RULES` entry is marked processed without erroring (verifies the intentional "not every event needs a notification" fallback).

## Offline/reconnect tests
12. A client that missed 3 messages across 2 challenges while disconnected receives all 3, correctly grouped by `challengeId`, via `syncSince`.
13. Messages sent exactly at `sinceTimestamp` are excluded (strict `gt`, not `gte`) -- verifies no duplicate delivery on reconnect.

## Delivery/concurrency tests
14. Two participants marking the same message `seen` concurrently -- verify `message_receipts` ends up with both rows, no lost update (this is a straightforward upsert with a composite primary key, but should be verified under real concurrency, not just assumed from the SQL).

## Load tests
15. Realtime Broadcast fan-out latency for typing indicators under concurrent load -- this measures Supabase's own infrastructure, not this codebase's logic, but should still be measured before committing to a client-side UX assumption (e.g. "typing indicator appears within 200ms").
16. `notification-dispatch-every-minute`'s throughput against a backlog of 10,000+ unprocessed `domain_events` -- confirms the `limit(100)` batching in `processUnhandledEvents` drains a backlog within an acceptable number of cron cycles rather than falling permanently behind.
