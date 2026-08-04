-- ============================================================================
-- Migration 0006: Games, Platforms, Regions, Challenges
-- Tables: platforms, regions, games, challenges, challenge_participants,
--         challenge_events, challenge_messages, challenge_attachments
--
-- Note: platforms and regions are implemented as seedable lookup tables
-- rather than enums (the brief's Step 8 explicitly asks to "populate
-- Platforms" and "Regions" as seed data, which implies rows, not a fixed
-- enum type that would require a schema migration to extend).
-- ============================================================================

create table platforms (
  code text primary key,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table platforms is 'Seedable lookup of supported gaming platforms (e.g. pc, playstation, xbox).';

create table regions (
  code text primary key,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table regions is 'Seedable lookup of supported matchmaking regions.';

-- games -----------------------------------------------------------------
create table games (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  icon_url text,
  supported_platform_codes text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table games is 'Catalogue of games available for challenges/tournaments.';

create unique index uq_games_slug on games (slug);
create index idx_games_active on games (active);
create index idx_games_name_trgm on games using gin (name gin_trgm_ops);

-- challenges --------------------------------------------------------------
-- Central state-machine table. Status values and transitions are the
-- authoritative expanded state machine from Business Rules §3.
create table challenges (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references profiles (id) on delete restrict,
  opponent_id uuid references profiles (id) on delete restrict,
  game_id uuid not null references games (id) on delete restrict,
  tournament_id uuid, -- FK added in migration 0007; null for standalone 1v1 challenges
  match_type text not null,
  stake_cents bigint not null,
  visibility challenge_visibility not null default 'public',
  platform_code text not null references platforms (code),
  region_code text not null references regions (code),
  status challenge_status not null default 'draft',
  release_reason escrow_release_reason,
  result_locked boolean not null default false, -- concurrency guard, Business Rules §7
  winner_submitted_by uuid references profiles (id),
  winner_submitted_at timestamptz,
  ready_deadline_at timestamptz,
  live_started_at timestamptz,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  archived_at timestamptz,
  constraint chk_challenges_stake_positive check (stake_cents > 0),
  constraint chk_challenges_creator_not_opponent check (creator_id is distinct from opponent_id)
);
comment on table challenges is
  'Central challenge state machine (Business Rules §3). One row per 1v1 challenge or per tournament match.';

create index idx_challenges_status_game_id on challenges (status, game_id);
create index idx_challenges_creator_id on challenges (creator_id);
create index idx_challenges_opponent_id on challenges (opponent_id) where opponent_id is not null;
create index idx_challenges_tournament_id on challenges (tournament_id) where tournament_id is not null;
create index idx_challenges_expires_at on challenges (expires_at) where status in ('published', 'waiting');
create index idx_challenges_ready_deadline on challenges (ready_deadline_at) where status = 'ready';

-- challenge_participants ----------------------------------------------------
-- Normalizes creator/opponent into a join table so per-participant state
-- (stake locked amount, ready timestamp) doesn't need duplicate columns on
-- challenges for each side.
create table challenge_participants (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references challenges (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete restrict,
  role challenge_participant_role not null,
  stake_locked_cents bigint,
  ready_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_challenge_participants_challenge_user unique (challenge_id, user_id),
  constraint uq_challenge_participants_challenge_role unique (challenge_id, role)
);
comment on table challenge_participants is
  'One row per side of a challenge (creator/opponent), tracking per-participant stake and ready-check state.';

create index idx_challenge_participants_user_id on challenge_participants (user_id);

-- challenge_events ------------------------------------------------------
-- Append-only log of state transitions for a single challenge, scoped
-- subset of the full System Events catalogue (Business Rules §18).
create table challenge_events (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references challenges (id) on delete cascade,
  event_type text not null,
  actor_id uuid references profiles (id), -- null = system-triggered
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
comment on table challenge_events is
  'Append-only per-challenge event log (ChallengeCreated, EscrowLocked, WinnerSubmitted, etc. — Business Rules §18).';

create index idx_challenge_events_challenge_id_created_at on challenge_events (challenge_id, created_at);
create index idx_challenge_events_event_type on challenge_events (event_type);

-- challenge_messages ------------------------------------------------------
-- Private per-challenge chat (Business Rules §8). Becomes read-only once the
-- challenge reaches a terminal state (enforced by trigger, migration 0012).
create table challenge_messages (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references challenges (id) on delete cascade,
  sender_id uuid references profiles (id), -- null = system message
  type chat_message_type not null default 'text',
  content text,
  media_url text,
  seen_by uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  constraint chk_challenge_messages_content_or_media check (
    content is not null or media_url is not null or type = 'system'
  )
);
comment on table challenge_messages is
  'Private per-challenge chat (Business Rules §8). Read-only once the challenge is completed/cancelled/expired/archived.';

create index idx_challenge_messages_challenge_id_created_at on challenge_messages (challenge_id, created_at);

-- challenge_attachments -----------------------------------------------------
-- Formal media evidence attached during a live match (distinct from informal
-- chat uploads and from dispute_evidence, which is the *submitted* proof
-- artifact reviewed by a moderator — Business Rules §8/§9).
create table challenge_attachments (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references challenges (id) on delete cascade,
  uploaded_by uuid not null references profiles (id),
  attachment_type evidence_type not null,
  storage_path text not null,
  created_at timestamptz not null default now()
);
comment on table challenge_attachments is
  'Media evidence attached during a live match, stored in the chat-media bucket.';

create index idx_challenge_attachments_challenge_id on challenge_attachments (challenge_id);

-- Now that wallet_transactions and challenges both exist, wire up the
-- deferred foreign keys from migration 0004/0005.
alter table wallet_transactions
  add constraint fk_wallet_transactions_challenge
  foreign key (related_challenge_id) references challenges (id) on delete set null;

alter table escrow_accounts
  add constraint fk_escrow_accounts_challenge
  foreign key (challenge_id) references challenges (id) on delete restrict;
