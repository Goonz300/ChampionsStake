-- ============================================================================
-- Migration 0037: Wallet Reconciliation Runs Table
--
-- SCOPE NOTE: Business Rules §15 and the Readiness Report both call for a
-- reconciliation job comparing cached wallet balances against the
-- ledger-derived truth (v_wallet_summary, DB-001 migration 0013, already
-- surfaces the comparison for ad-hoc querying). This phase needs a durable
-- record of each reconciliation *run* — when it ran, what it found, whether
-- any wallet had to be frozen — which v_wallet_summary alone doesn't provide
-- (it's a live view, not a history).
-- ============================================================================

create type reconciliation_run_status as enum ('completed', 'completed_with_mismatches', 'failed');

create table wallet_reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status reconciliation_run_status not null default 'completed',
  wallets_checked int not null default 0,
  mismatches_found int not null default 0,
  wallets_frozen int not null default 0,
  details jsonb not null default '[]'::jsonb,
  triggered_by uuid references profiles (id), -- null = scheduled/system run
  created_at timestamptz not null default now()
);
comment on table wallet_reconciliation_runs is
  'Durable history of each wallet reconciliation run (Business Rules §15, Readiness Report Critical #3/#6). details is an array of {wallet_id, cached, ledger_derived, drift_cents} for every mismatch found.';

create index idx_wallet_reconciliation_runs_started_at on wallet_reconciliation_runs (started_at desc);
create index idx_wallet_reconciliation_runs_status on wallet_reconciliation_runs (status) where status <> 'completed';

alter table wallet_reconciliation_runs enable row level security;
alter table wallet_reconciliation_runs force row level security;

create policy wallet_reconciliation_runs_select_staff on wallet_reconciliation_runs
  for select
  using (is_admin());
-- No client insert/update/delete: only the wallet-reconciliation Edge
-- Function (service_role) writes here.
