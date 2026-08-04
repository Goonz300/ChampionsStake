# ChampionsStake Realtime Communication & Notification Platform

## Architecture

Supabase Realtime IS the realtime gateway/connection manager/subscription manager this phase's brief asks for — there is no custom WebSocket server or connection pool in this codebase, because building one would duplicate infrastructure Supabase already runs and horizontally scales. This project's code contributes three things on top of that transport:

1. **Postgres Changes** (migration 0053): tables added to the `supabase_realtime` publication stream row-level INSERT/UPDATE/DELETE events directly from Postgres's replication log to any authorized subscribed client. RLS (already established in DB-002/AUTH-001/CHALLENGE-001/WALLET-001) is what filters *which* client receives *which* row's changes — adding a table to the publication does not bypass any access control.
2. **Broadcast** (typing indicators, `_realtime/typing.ts`): ephemeral, unstored, fire-and-forget messages on a per-challenge channel.
3. **Presence** (online/away/in-match): Supabase's built-in Presence feature tracks connected clients per channel in-memory. `user_presence` (migration 0051) stores only the two facts that must survive a disconnect — last-seen and current challenge — never the moment-to-moment ephemeral state itself.

## Folder Structure

```
supabase/functions/_realtime/
  types.ts
  chat.ts        send/edit/delete/get messages, delivery+read receipts (reuses STORE-001 via file_upload_id reference, never re-implements upload validation)
  notifications.ts   consumes EDGE-001's domain_events, maps to notifications rows respecting AUTH-001's user_preferences
  presence.ts     durable last-seen/current-challenge only
  typing.ts       thin wrapper over Realtime Broadcast
  sync.ts         reconnect/resync from existing durable tables
supabase/functions/
  chat-send/ chat-edit/ chat-delete/
  notification-send/ presence-update/ typing-update/ mark-read/ sync-events/
supabase/migrations/0049-0053
```

## Chat

One private chat per challenge (`challenge_messages`, DB-001), participants only (RLS, DB-002), opens automatically at `escrow_locked` (CHALLENGE-001 already emits `ChatOpened` at that point), read-only automatically once the challenge reaches a terminal state (`fn_challenge_messages_read_only_guard`, unchanged from DB-001). Editing (5-minute window, sender-only) and soft-deletion (tombstone, original content preserved) are new this phase, resolving a real tension with DB-001's original "fully immutable" chat design — documented explicitly in migration 0049 rather than silently overridden.

## Media

**Never duplicates STORE-001.** A different runtime boundary (Next.js/Node vs. these Deno Edge Functions) means the upload pipeline can't be imported directly, so media messages are a two-step flow: upload via the existing `POST /api/storage/upload` (unchanged), then `chat-send` with the resulting `file_upload_id` — verified against `file_uploads` (owner, status, bucket, related entity) before a message references it. Signed URL generation at read time is a single trivial Storage SDK call, not a reimplementation of STORE-001's validation/authorization logic.

## Presence, Read Receipts, Typing

Presence: `user_presence` + `v_public_presence` view (same pattern as AUTH-001's `v_public_profiles`). Read receipts: `message_receipts` (new table, migration 0050) tracks per-recipient delivered/seen timestamps — DB-001's bare `seen_by` array said *who* but never *when*. Typing: Broadcast only, zero persistence.

## Notification Centre

10 categories (migration 0052) layered on top of DB-001's existing free-text `type` column — the same category/action split `audit_logs` already established. `notifications.ts`'s `EVENT_RULES` mapping table is the actual "Notification Service": it reads `domain_events` (never reimplements what emitted them), resolves recipients, checks `user_preferences`, and inserts a `notifications` row. Extending to a new event type is one new map entry, not a new file.

## Offline Synchronization

`syncSince`/`syncChallengeSince` query the already-durable, already-ordered tables (`notifications`, `challenge_messages`) rather than inventing a parallel event log. Ordering is each table's own `created_at`; conflict detection is the client's job (reconciling optimistic local state against the authoritative rows returned).

## Known Limitations (stated, not hidden)

- **Sub-minute scheduling**: stale-presence sweep and notification dispatch aren't wired to pg_cron by default, for the identical reason CHALLENGE-001/TOURNAMENT-001 documented — short-window polling across every active entity is a poor fit for pg_cron's granularity. Both are exposed as callable functions for whichever future phase builds precise scheduling.
- **100,000+ concurrent connections / horizontal scaling**: this is Supabase Realtime's own infrastructure concern, not something this codebase's logic affects one way or the other — there is no connection-handling code here to scale.
