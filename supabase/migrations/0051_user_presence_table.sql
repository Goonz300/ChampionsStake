-- ============================================================================
-- Migration 0051: User Presence Table
--
-- SCOPE NOTE: online/away/typing are genuinely ephemeral and are handled by
-- Supabase Realtime's built-in Presence/Broadcast features (in-memory,
-- per-channel, never persisted — see REALTIME_PLATFORM.md's architecture
-- note on this). What DOES need durable storage is "Last Seen" (must
-- survive a disconnect) and "Current Challenge" (informational, queryable
-- outside of an active Realtime session) — this table holds exactly those
-- two durable facts, nothing ephemeral.
-- ============================================================================

create type presence_status as enum ('online', 'offline', 'away', 'in_match', 'ready');

create table user_presence (
  user_id uuid primary key references profiles (id) on delete cascade,
  status presence_status not null default 'offline',
  last_seen_at timestamptz not null default now(),
  current_challenge_id uuid references challenges (id) on delete set null,
  updated_at timestamptz not null default now()
);
comment on table user_presence is
  'Durable last-known presence per user. Ephemeral moment-to-moment state (typing, live online ping) is Supabase Realtime Presence, not this table — see REALTIME_PLATFORM.md.';

create trigger trg_user_presence_updated_at before update on user_presence
  for each row execute function fn_set_updated_at();

alter table user_presence enable row level security;
alter table user_presence force row level security;

-- Public-safe projection, same pattern as v_public_profiles (AUTH-001) —
-- other users may see status/last_seen (useful for "is my opponent
-- online"), but not necessarily current_challenge_id if that challenge is
-- private; a view keeps that distinction enforceable in one place.
create view v_public_presence
with (security_invoker = true) as
select user_id, status, last_seen_at
from user_presence;

grant select on v_public_presence to anon, authenticated;

create policy user_presence_select_own on user_presence
  for select
  using (user_id = auth.uid());

create policy user_presence_select_challenge_participant on user_presence
  for select
  using (
    current_challenge_id is not null
    and is_challenge_participant(current_challenge_id)
  );

-- No client INSERT/UPDATE/DELETE policy: presence rows are written
-- exclusively by the presence-update Edge Function (service_role), which
-- validates the caller's own identity from their JWT before writing —
-- never trusting a client-supplied user_id.
