-- ============================================================================
-- Migration 0007: Tournament Tables
-- Tables: tournaments, tournament_registrations, tournament_rounds,
--         tournament_matches
-- ============================================================================

create table tournaments (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games (id) on delete restrict,
  name text not null,
  format tournament_format not null,
  entry_fee_cents bigint not null,
  prize_pool_cents bigint not null default 0,
  payout_structure jsonb not null default '{"1": 60, "2": 30, "3": 10}'::jsonb,
  status tournament_status not null default 'draft',
  registration_opens_at timestamptz,
  registration_closes_at timestamptz,
  check_in_opens_at timestamptz,
  starts_at timestamptz,
  created_by uuid not null references profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint chk_tournaments_entry_fee_nonneg check (entry_fee_cents >= 0)
);
comment on table tournaments is
  'Tournament definition (Business Rules §5). Matches within a tournament reuse the Challenge state machine.';

create index idx_tournaments_status_game_id on tournaments (status, game_id);
create index idx_tournaments_starts_at on tournaments (starts_at);

-- tournament_registrations ---------------------------------------------
create table tournament_registrations (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete restrict,
  seed int,
  checked_in_at timestamptz,
  eliminated boolean not null default false,
  forfeited boolean not null default false,
  entry_escrow_transaction_id uuid references escrow_transactions (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_tournament_registrations_tournament_user unique (tournament_id, user_id)
);
comment on table tournament_registrations is
  'Entrant registration for a tournament, including seed (trust-score derived, Business Rules §5) and check-in state.';

create index idx_tournament_registrations_tournament_id on tournament_registrations (tournament_id);
create index idx_tournament_registrations_user_id on tournament_registrations (user_id);

-- tournament_rounds -------------------------------------------------------
create table tournament_rounds (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments (id) on delete cascade,
  round_number int not null,
  name text,
  status tournament_round_status not null default 'pending',
  starts_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_tournament_rounds_tournament_round unique (tournament_id, round_number)
);
comment on table tournament_rounds is 'One row per bracket round within a tournament.';

create index idx_tournament_rounds_tournament_id on tournament_rounds (tournament_id);

-- tournament_matches ------------------------------------------------------
-- Links a bracket position to the Challenge instance that actually carries
-- the escrow/dispute machinery (Business Rules §5: "each round's matches are
-- standard Challenge Lifecycle instances").
create table tournament_matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments (id) on delete cascade,
  round_id uuid not null references tournament_rounds (id) on delete cascade,
  challenge_id uuid not null unique references challenges (id) on delete restrict,
  bracket_position int not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_tournament_matches_round_position unique (round_id, bracket_position)
);
comment on table tournament_matches is
  'Maps a bracket position to its Challenge instance. Tournament matches reuse the Challenge escrow/dispute engine.';

create index idx_tournament_matches_tournament_id on tournament_matches (tournament_id);
create index idx_tournament_matches_round_id on tournament_matches (round_id);

-- Wire up the deferred foreign keys now that tournaments exists.
alter table challenges
  add constraint fk_challenges_tournament
  foreign key (tournament_id) references tournaments (id) on delete set null;

alter table wallet_transactions
  add constraint fk_wallet_transactions_tournament
  foreign key (related_tournament_id) references tournaments (id) on delete set null;

alter table escrow_accounts
  add constraint fk_escrow_accounts_tournament
  foreign key (tournament_id) references tournaments (id) on delete restrict;
