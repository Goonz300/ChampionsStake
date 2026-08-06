-- ============================================================================
-- Migration 0078: Realtime Broadcast Authorization (Typing Channel Isolation)
--
-- Phase 4 independent-review finding: Postgres Changes (challenges,
-- challenge_messages, notifications, user_presence, wallets, etc. --
-- migration 0053/0077) are correctly authorized by each table's own RLS,
-- confirmed already. Broadcast is different -- it has no backing table,
-- so table RLS cannot govern it at all. Without Realtime's own
-- Authorization mechanism (private channels + RLS on realtime.messages),
-- Supabase Broadcast channels are, by default, open to any authenticated
-- client who can guess/construct a topic name: a malicious client could
-- call supabase.channel("chat:{anyChallengeId}").send(...) directly from
-- the browser SDK, broadcasting a FORGED typing_started event (with any
-- userId in the payload) into a challenge they are not a participant in
-- -- entirely bypassing typing-update/index.ts's requirePlayer +
-- isParticipant check, since that check only runs for callers who go
-- through the Edge Function, not clients calling Realtime directly.
--
-- This is the one Broadcast usage in the platform (_realtime/typing.ts,
-- topic "chat:{challengeId}") -- every other channel this phase's client
-- hooks use is Postgres-Changes-only, already correctly scoped by table
-- RLS, and does not need this (marking a channel private only affects
-- Broadcast/Presence authorization, not Postgres Changes).
--
-- Reuses the EXISTING is_challenge_participant() function (migration
-- 0016) -- the same authorization RULE typing-update's own check and the
-- chat RLS policies already use -- applied to this new enforcement point,
-- not a second, parallel definition of "who may access this challenge's
-- chat."
--
-- VERIFICATION NOTE (stated honestly, matching every migration in this
-- project): the exact realtime.topic() function signature and
-- realtime.messages RLS mechanics could not be exercised against a live
-- Supabase project in this environment (no Deno runtime, no live
-- Postgres/Realtime -- the same limitation every prior phase has noted).
-- This migration should be verified against a real Supabase project
-- (`supabase db push` to a staging instance + a manual private-channel
-- broadcast test) before production deploy. The corresponding client-side
-- change (marking the "chat:{challengeId}" channel private so this RLS is
-- actually consulted) is in useTyping.ts, same commit.
-- ============================================================================

alter table realtime.messages enable row level security;

create policy realtime_chat_broadcast_participants_select on realtime.messages
  for select
  to authenticated
  using (
    realtime.topic() ~ '^chat:[0-9a-fA-F-]{36}$'
    and is_challenge_participant(substring(realtime.topic() from 6)::uuid)
  );

create policy realtime_chat_broadcast_participants_insert on realtime.messages
  for insert
  to authenticated
  with check (
    realtime.topic() ~ '^chat:[0-9a-fA-F-]{36}$'
    and is_challenge_participant(substring(realtime.topic() from 6)::uuid)
  );
