-- ============================================================================
-- Migration 0050: Message Receipts Table
--
-- SCOPE NOTE: DB-001's challenge_messages.seen_by (a bare uuid[]) can say
-- WHO saw a message but not WHEN, and has no "delivered" concept at all.
-- This phase explicitly requires Sent/Delivered/Seen with timestamps —
-- genuinely new structured state, added as its own table rather than
-- bloating challenge_messages with per-recipient timestamp columns (a
-- challenge only ever has 2 participants, but this table generalizes
-- cleanly if that ever changes, and keeps challenge_messages itself free
-- of a growing number of receipt-tracking columns).
-- ============================================================================

create table message_receipts (
  message_id uuid not null references challenge_messages (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  delivered_at timestamptz,
  seen_at timestamptz,
  primary key (message_id, user_id)
);
comment on table message_receipts is
  'Per-recipient delivered/seen timestamps for chat messages (Sent = the message row itself existing).';

create index idx_message_receipts_user_id on message_receipts (user_id);

alter table message_receipts enable row level security;
alter table message_receipts force row level security;

create policy message_receipts_select_participant on message_receipts
  for select
  using (
    exists (
      select 1 from challenge_messages cm
      where cm.id = message_receipts.message_id
        and is_challenge_participant(cm.challenge_id)
    )
  );

create policy message_receipts_upsert_own on message_receipts
  for insert
  with check (user_id = auth.uid());

create policy message_receipts_update_own on message_receipts
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
