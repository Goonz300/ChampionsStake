-- ============================================================================
-- Migration 0004: Wallet & Ledger Tables
-- Tables: wallets, wallet_transactions, wallet_ledger
--
-- FINANCIAL DESIGN NOTE (read before touching this file):
-- This schema uses a true double-entry ledger. wallet_ledger is the
-- append-only, immutable source of truth; wallets.available_cents and
-- wallets.escrowed_cents are a *cached, trigger-maintained* projection of
-- that ledger, never written to directly by application code. Every
-- balance-affecting event is one wallet_transactions row plus a *balanced*
-- set of wallet_ledger rows (sum of debits = sum of credits) tied to it.
-- See migration 0011 for the deferred constraint trigger that enforces the
-- balance invariant, and 0012 for the trigger that keeps wallets' cached
-- columns in sync.
-- ============================================================================

-- wallets ---------------------------------------------------------------
create table wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references profiles (id) on delete cascade,
  status wallet_status not null default 'active',
  currency text not null default 'USD',
  -- Cached projection of wallet_ledger — see design note above. Application
  -- roles have UPDATE revoked on these two columns in migration 0013 (RLS
  -- phase); only the internal trigger function may write them.
  available_cents bigint not null default 0,
  escrowed_cents bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_wallets_currency check (currency = 'USD'), -- v1 is USD-only, Business Rules §6
  constraint chk_wallets_available_nonneg check (available_cents >= 0),
  constraint chk_wallets_escrowed_nonneg check (escrowed_cents >= 0)
);
comment on table wallets is
  'One wallet per user. available_cents/escrowed_cents are a cached projection of wallet_ledger, never written directly by application code.';

create index idx_wallets_status on wallets (status);

-- wallet_transactions ---------------------------------------------------
-- One row per discrete financial event (deposit, withdrawal, stake lock,
-- payout, refund, fee, manual adjustment). This is the unit that ledger
-- entries attach to and that idempotency keys / webhook dedupe are scoped to.
create table wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references wallets (id) on delete restrict,
  type transaction_type not null,
  status transaction_status not null default 'pending',
  amount_cents bigint not null,
  currency text not null default 'USD',
  provider text, -- e.g. 'stripe'; null for purely internal transactions (stake/payout/refund)
  provider_ref text, -- external payment-intent/payout id, for webhook correlation
  idempotency_key uuid,
  related_challenge_id uuid, -- FK added in migration 0006 once challenges exists
  related_tournament_id uuid, -- FK added in migration 0007 once tournaments exists
  release_reason escrow_release_reason,
  initiated_by uuid references profiles (id),
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint chk_wallet_transactions_amount_positive check (amount_cents > 0)
);
comment on table wallet_transactions is
  'One row per financial event. Never deleted; once status=completed, mutation is blocked by trigger (migration 0012).';

create index idx_wallet_transactions_wallet_id_created_at on wallet_transactions (wallet_id, created_at desc);
create index idx_wallet_transactions_status on wallet_transactions (status);
create index idx_wallet_transactions_type on wallet_transactions (type);
create unique index uq_wallet_transactions_idempotency_key on wallet_transactions (idempotency_key) where idempotency_key is not null;
create index idx_wallet_transactions_provider_ref on wallet_transactions (provider, provider_ref) where provider_ref is not null;

-- wallet_ledger -----------------------------------------------------------
-- Immutable double-entry ledger. Every row is one debit or credit leg against
-- one account (a wallet's available or escrowed sub-balance, or one of the
-- two singleton platform accounts). Rows are never updated or deleted
-- (enforced in migration 0012).
create table wallet_ledger (
  id uuid primary key default gen_random_uuid(),
  wallet_transaction_id uuid not null references wallet_transactions (id) on delete restrict,
  wallet_id uuid references wallets (id) on delete restrict,
  account_type ledger_account_type not null,
  direction ledger_direction not null,
  amount_cents bigint not null,
  created_at timestamptz not null default now(),
  constraint chk_wallet_ledger_amount_positive check (amount_cents > 0),
  constraint chk_wallet_ledger_account_wallet_pairing check (
    (wallet_id is not null and account_type in ('available', 'escrowed'))
    or
    (wallet_id is null and account_type in ('platform_fee_revenue', 'platform_clearing'))
  )
);
comment on table wallet_ledger is
  'Append-only double-entry ledger. Source of truth for all balances. Never updated or deleted after insert.';

create index idx_wallet_ledger_wallet_id_account_type on wallet_ledger (wallet_id, account_type);
create index idx_wallet_ledger_transaction_id on wallet_ledger (wallet_transaction_id);
create index idx_wallet_ledger_created_at on wallet_ledger (created_at);
