-- ============================================================================
-- Migration 0038: Wallet Adjustment Requests Table
--
-- SCOPE NOTE: the four-eyes wallet-adjustment workflow (Business Rules §11,
-- API Spec ADMIN-EP-04/05) needs somewhere to hold a PROPOSED adjustment
-- between the first admin's request and a second, different admin's
-- approval — neither DB-001 nor any later phase created this. Without it,
-- "requires a second admin's sign-off within 24h" has no durable state to
-- check against.
-- ============================================================================

create type wallet_adjustment_status as enum ('pending_approval', 'approved', 'rejected', 'expired');

create table wallet_adjustment_requests (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references wallets (id) on delete restrict,
  amount_cents bigint not null,
  direction ledger_direction not null,
  reason text not null,
  status wallet_adjustment_status not null default 'pending_approval',
  proposed_by uuid not null references profiles (id),
  approved_by uuid references profiles (id),
  resulting_transaction_id uuid references wallet_transactions (id),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  constraint chk_wallet_adjustment_amount_positive check (amount_cents > 0),
  constraint chk_wallet_adjustment_different_approver check (approved_by is distinct from proposed_by)
);
comment on table wallet_adjustment_requests is
  'Holds a proposed administrative wallet adjustment between the proposing admin''s request and a second, different admin''s approval (Business Rules §11 four-eyes principle).';

create index idx_wallet_adjustment_requests_status on wallet_adjustment_requests (status) where status = 'pending_approval';
create index idx_wallet_adjustment_requests_wallet_id on wallet_adjustment_requests (wallet_id);

alter table wallet_adjustment_requests enable row level security;
alter table wallet_adjustment_requests force row level security;

create policy wallet_adjustment_requests_select_admin on wallet_adjustment_requests
  for select
  using (is_admin());
-- No client insert/update/delete: only the wallet-adjustment Edge Function
-- (service_role) writes here, after verifying the caller is an
-- administrator itself via JWT (framework-level check, not RLS).
