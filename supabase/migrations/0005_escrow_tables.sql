-- ============================================================================
-- Migration 0005: Escrow Tables
-- Tables: escrow_accounts, escrow_transactions
-- ============================================================================

-- escrow_accounts ---------------------------------------------------------
-- One escrow "container" per challenge (1v1 match) or tournament entry pool.
-- Exactly one of challenge_id / tournament_id is set (enforced by check).
create table escrow_accounts (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid unique, -- FK added in migration 0006
  tournament_id uuid unique, -- FK added in migration 0007
  status escrow_status not null default 'locked',
  total_locked_cents bigint not null default 0,
  release_reason escrow_release_reason,
  released_to_wallet_id uuid references wallets (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  released_at timestamptz,
  constraint chk_escrow_accounts_exactly_one_owner check (
    (challenge_id is not null and tournament_id is null)
    or
    (challenge_id is null and tournament_id is not null)
  ),
  constraint chk_escrow_accounts_total_nonneg check (total_locked_cents >= 0)
);
comment on table escrow_accounts is
  'One escrow container per challenge or tournament entry pool (Business Rules §7). Exactly one owner reference is set.';

create index idx_escrow_accounts_status on escrow_accounts (status);

-- escrow_transactions -------------------------------------------------------
-- Individual lock/release/refund/void events against an escrow account. Each
-- row is tied 1:1 to the wallet_transaction that actually moved the ledger
-- entries, giving a complete audit trail linking escrow state to money movement.
create table escrow_transactions (
  id uuid primary key default gen_random_uuid(),
  escrow_account_id uuid not null references escrow_accounts (id) on delete restrict,
  wallet_transaction_id uuid not null references wallet_transactions (id) on delete restrict,
  action text not null,
  amount_cents bigint not null,
  actor_id uuid references profiles (id), -- null = system-triggered (e.g. auto-expiry)
  created_at timestamptz not null default now(),
  constraint chk_escrow_transactions_action check (action in ('lock', 'release', 'refund', 'void')),
  constraint chk_escrow_transactions_amount_positive check (amount_cents > 0)
);
comment on table escrow_transactions is
  'Immutable log of every lock/release/refund/void event against an escrow account, linked to the wallet_transaction that moved the money.';

create index idx_escrow_transactions_escrow_account_id on escrow_transactions (escrow_account_id);
create index idx_escrow_transactions_wallet_transaction_id on escrow_transactions (wallet_transaction_id);
