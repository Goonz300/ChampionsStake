# REALTIME-001 — Realtime Communication & Notification Platform

**Process note**: this phase's schema (migrations 0049-0053) already existed when I began working on it -- well-reasoned, internally consistent with every prior phase's patterns (honesty notes on ephemeral-vs-durable state, explicit tension resolution with DB-001's original chat-immutability design). I verified all 5 pre-existing migrations (balance, rollback completeness) before building on top, rather than assuming or redoing them. This document covers the full phase, both the schema I verified and the application layer (domain library, 8 Edge Functions, docs) I built this turn.

## 1. Realtime Architecture

Supabase Realtime **is** the gateway/connection-manager/subscription-manager this phase asks for -- Postgres Changes (RLS-filtered row streaming, migration 0053), Broadcast (typing, zero persistence), and Presence (online/away, backed by `user_presence` for the two facts that must survive a disconnect) are all native Supabase features, not custom infrastructure reimplemented here. Full explanation in `REALTIME_PLATFORM.md`.

## 2. Folder Structure

```
supabase/functions/_realtime/
  types.ts, chat.ts, notifications.ts, presence.ts, typing.ts, sync.ts
supabase/functions/
  chat-send/ chat-edit/ chat-delete/
  notification-send/ presence-update/ typing-update/ mark-read/ sync-events/
supabase/migrations/0049-0054
supabase/functions/REALTIME_PLATFORM.md, REALTIME_TESTS.md
```

## 3. Chat Service

Reuses STORE-001 without duplicating it -- a real architectural constraint worth stating plainly: STORE-001's upload pipeline lives in the Next.js app (Node runtime), these Edge Functions run on Deno, so direct import is impossible. Media messages are a two-step flow (upload via the existing `/api/storage/upload`, then `chat-send` referencing the resulting `file_upload_id`), with `chat-send` verifying ownership/status/bucket/related-entity before allowing the reference -- no upload validation logic is reimplemented, only referenced and checked. Editing (5-minute window) and soft-deletion (tombstone, `original_content` preserved) resolve a genuine tension with DB-001's original "fully immutable" chat design, documented explicitly in migration 0049 rather than silently overridden.

## 4. Notification Service

`notifications.ts`'s `EVENT_RULES` table is the actual "Notification Service" -- it consumes `domain_events` (EDGE-001's existing durable log, never reimplemented), resolves recipients per event type, checks `user_preferences` (AUTH-001), and writes `notifications` rows respecting the 10 new categories (migration 0052). Extending to a new event type is one map entry, not a new file -- stated as a deliberate, honest scope boundary rather than claiming exhaustive coverage of every event name the brief listed.

## 5. Presence Service

`user_presence` (pre-existing migration 0051) + `v_public_presence` view store only durable facts (last-seen, current challenge). Moment-to-moment online/away/typing state is Supabase Presence/Broadcast, never written to Postgres -- explained in both the migration's own comment and `REALTIME_PLATFORM.md`, since conflating "ephemeral" and "durable" state is the most common realtime-architecture mistake this phase needed to avoid.

## 6. Event Dispatcher

`processUnhandledEvents` -- idempotent (marks `processed_at` immediately per event), batched (`limit(100)` per run), scheduled every minute (migration 0054, the one scheduler in this project so far that tolerates 1-minute granularity rather than needing the sub-minute precision CHALLENGE-001/TOURNAMENT-001 flagged as a gap).

## 7. Edge Functions

All 8 requested, each thin and built on EDGE-001's `withEdgeFunction()`. `chat-send`/`chat-edit`/`chat-delete` cover the write path; `mark-read` handles both chat receipts and notification read-status behind one endpoint (discriminated by `target`, avoiding two near-identical tiny functions); `sync-events` serves both full-account and single-challenge resync.

## 8. APIs

Messages (send/edit/delete/get with signed-URL resolution at read time), Notifications (list via existing `notifications` table + category filter, mark read), Presence (update/get), Typing (broadcast), Read Receipts (`message_receipts`), Subscriptions (documented -- clients subscribe directly to Postgres Changes/Broadcast/Presence channels per `REALTIME_PLATFORM.md`, no server-side "subscribe" endpoint exists because Supabase's client SDK handles that directly), Preferences (already AUTH-001's `user_preferences`, read by the notification dispatcher, not duplicated here).

## 9. Tests

`REALTIME_TESTS.md` -- 16 tests across chat/presence/notification/offline/concurrency/load. **Stated honestly**: unlike TOURNAMENT-001's bracket engine, almost none of this phase's logic is pure computation -- chat, presence, and notification dispatch all touch the database immediately, so there's no meaningful offline unit-test surface the way `bracket.test.ts` had. Every test needs a live Supabase project with Realtime enabled.

## 10. Verification Checklist

- [x] Every table added to the `supabase_realtime` publication already has RLS from a prior phase -- verified by cross-referencing migration 0053's table list against DB-002/CHALLENGE-001/WALLET-001's policies; adding a table to Realtime does not bypass any access control
- [x] No upload/validation logic duplicated from STORE-001 -- verified by grep: no MIME/size/checksum validation exists anywhere in `_realtime/chat.ts`, only a reference check against `file_uploads`
- [x] `updatePresence`'s Edge Function never accepts a client-supplied `user_id` -- verified by re-reading `presence-update/index.ts`
- [x] Typing indicators are genuinely zero-persistence -- verified: `typing.ts` never calls `.insert()`/`.upsert()`, only `channel.send()`
- [x] All new/modified files pass the full comment/string-aware bracket-balance check across the entire `supabase/functions` tree (including the 5 pre-existing migrations I verified rather than assumed)
- [x] Every cross-module import (`_realtime` <-> `_challenge` <-> `_shared`) verified against real exports
- [ ] **Not verified in this environment**: no Deno runtime, no live Postgres, no Realtime connection -- same limitation as every prior phase. All 16 tests in `REALTIME_TESTS.md` need a live environment.

## 11. Realtime Integrity Report

**Structurally guaranteed**: chat read-only-after-terminal-state and participant-only access are enforced by pre-existing DB-001/DB-002 triggers/RLS, not re-implemented here; notification dispatch cannot double-notify (idempotent per-event marking); presence updates are always scoped to the caller's own identity, never client-supplied.

**Deliberately not built**: a custom WebSocket/connection-management layer, because Supabase Realtime already provides one -- building a duplicate would be the opposite of "reuse EDGE-001/STORE-001/CHALLENGE-001," even though those phases aren't the ones being duplicated in this case.

**Deferred, consistent with two prior phases' identical gap**: sub-minute presence-sweep/notification precision beyond the 1-minute cron tier isn't built -- the same "pg_cron is a poor fit for short per-entity windows" reasoning CHALLENGE-001 and TOURNAMENT-001 already established.

## Stop point

REALTIME-001 is complete. Per the established convention, stopping here -- not starting ADMIN-001 until you approve.
