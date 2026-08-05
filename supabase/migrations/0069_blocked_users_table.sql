-- ============================================================================
-- Migration 0069: Blocked Users
--
-- SCOPE NOTE (Phase 2 gap audit): friends.status (0008) has a 'blocked'
-- value, but it only applies within an existing friends row -- a user has
-- no way to block someone they were never friends with (e.g. an abusive
-- opponent from a challenge). This is a standalone table, independent of
-- friends; it does not alter the friends table, enum, or any existing
-- policy/trigger on it. Wiring this into challenge/chat visibility RLS is
-- deliberately left for a future phase -- this migration only adds the
-- durable block relationship and its own access policies, not new
-- cross-table visibility rules on challenges/messages that this phase's
-- brief did not ask for.
-- ============================================================================

create table blocked_users (
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references profiles (id) on delete cascade,
  blocked_id uuid not null references profiles (id) on delete cascade,
  reason text,
  created_at timestamptz not null default now(),
  constraint chk_blocked_users_not_self check (blocker_id is distinct from blocked_id),
  constraint uq_blocked_users_blocker_blocked unique (blocker_id, blocked_id)
);
comment on table blocked_users is
  'Standalone user-block relationship, independent of friends (which retains its own separate blocked status for friend-relationship history). No friendship required to block or be blocked.';

create index idx_blocked_users_blocker_id on blocked_users (blocker_id);
create index idx_blocked_users_blocked_id on blocked_users (blocked_id);

alter table blocked_users enable row level security;
alter table blocked_users force row level security;

-- Only the blocker can see their own block list -- the blocked party is
-- not informed who has blocked them (standard product behavior, and
-- consistent with not leaking moderation-adjacent signals to the target).
create policy blocked_users_select_own on blocked_users for select using (blocker_id = auth.uid());
create policy blocked_users_insert_own on blocked_users for insert with check (blocker_id = auth.uid());
create policy blocked_users_delete_own on blocked_users for delete using (blocker_id = auth.uid());
create policy blocked_users_select_staff on blocked_users for select using (is_admin() or is_moderator());
