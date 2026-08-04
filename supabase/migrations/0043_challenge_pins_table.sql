-- ============================================================================
-- Migration 0043: Challenge Pins Table
--
-- SCOPE NOTE: "Challenge Pinning" (bookmarking a challenge for quick access)
-- needs durable per-user state that nothing in DB-001 provides. "Challenge
-- Sharing" needs no schema — it's just constructing a URL to an existing
-- challenge id — so no table is added for that.
-- ============================================================================

create table challenge_pins (
  user_id uuid not null references profiles (id) on delete cascade,
  challenge_id uuid not null references challenges (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, challenge_id)
);
comment on table challenge_pins is 'User bookmarks of challenges for quick discovery access.';

create index idx_challenge_pins_user_id on challenge_pins (user_id, created_at desc);

alter table challenge_pins enable row level security;
alter table challenge_pins force row level security;

create policy challenge_pins_select_own on challenge_pins
  for select
  using (user_id = auth.uid());

create policy challenge_pins_insert_own on challenge_pins
  for insert
  with check (user_id = auth.uid());

create policy challenge_pins_delete_own on challenge_pins
  for delete
  using (user_id = auth.uid());
