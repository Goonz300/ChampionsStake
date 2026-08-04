-- ============================================================================
-- Migration 0008: Social & Notification Tables
-- Tables: notifications, friends, reports
-- ============================================================================

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  type text not null, -- System Event name, Business Rules §18 (extensible, see migration 0002 note)
  payload jsonb not null default '{}'::jsonb,
  status notification_status not null default 'unread',
  created_at timestamptz not null default now(),
  read_at timestamptz
);
comment on table notifications is
  'In-app notification feed per user (Business Rules §12). Realtime channel notifications:{user_id} fans out from inserts here.';

create index idx_notifications_user_id_status on notifications (user_id, status);
create index idx_notifications_user_id_created_at on notifications (user_id, created_at desc);

-- friends -----------------------------------------------------------------
create table friends (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references profiles (id) on delete cascade,
  addressee_id uuid not null references profiles (id) on delete cascade,
  status friend_request_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_friends_not_self check (requester_id is distinct from addressee_id),
  constraint uq_friends_requester_addressee unique (requester_id, addressee_id)
);
comment on table friends is 'Friend requests/relationships/blocks between users.';

create index idx_friends_addressee_id_status on friends (addressee_id, status);
create index idx_friends_requester_id_status on friends (requester_id, status);

-- reports -------------------------------------------------------------------
-- Covers chat-message reports (Business Rules §8) and general user reports.
create table reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references profiles (id),
  reported_user_id uuid references profiles (id),
  challenge_id uuid references challenges (id),
  message_id uuid references challenge_messages (id),
  reason text not null,
  status report_status not null default 'open',
  reviewed_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table reports is
  'User-submitted reports of chat messages or accounts. Does not itself pause the challenge lifecycle (Business Rules §8).';

create index idx_reports_status on reports (status);
create index idx_reports_reported_user_id on reports (reported_user_id) where reported_user_id is not null;
