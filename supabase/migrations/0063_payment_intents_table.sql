-- ============================================================================
-- Migration 0063: Payment Intents Table
--
-- TWO BUGS AVOIDED BY THIS MIGRATION'S DESIGN, both found while writing the
-- services that use it (not after — before either was ever wired up):
--
-- Bug 1 (deposits): the natural first draft pre-created a wallet_transactions
-- row (status='pending') at deposit-initialize time, then called
-- WALLET-001's completeDeposit() on verification — but completeDeposit()
-- goes through postBalancedEntries(), which ALWAYS inserts its OWN fresh
-- wallet_transactions row (WALLET-001's correct, unmodified single-write-path
-- design). Doing both would leave two transaction rows per real deposit.
--
-- Bug 2 (withdrawals): postBalancedEntries() always sets a transaction's
-- status to 'completed' immediately (correct — a hold moving funds
-- available->pending IS a real, immediately-settled ledger event). A first
-- draft of the withdrawal service tried to later UPDATE that same row's
-- status to 'processing' while waiting on the provider transfer — but
-- DB-001's fn_prevent_completed_transaction_mutation trigger blocks ANY
-- update once a transaction is 'completed', so that UPDATE would fail
-- against a real database.
--
-- Both bugs share one root cause: conflating "the ledger's record of money
-- that has genuinely moved" (wallet_transactions — always immediately
-- final, by design) with "the payment layer's record of an in-flight
-- provider interaction" (this table — explicitly mutable while pending).
-- This table is generic across both deposit and withdrawal intents (a
-- `kind` discriminator) so both services share one bookkeeping mechanism.
-- ============================================================================

create type payment_intent_status as enum ('pending', 'completed', 'failed', 'expired');
create type payment_intent_kind as enum ('deposit', 'withdrawal');

create table payment_intents (
  id uuid primary key default gen_random_uuid(),
  kind payment_intent_kind not null,
  user_id uuid not null references profiles (id),
  wallet_id uuid not null references wallets (id),
  provider text not null,
  provider_ref text,
  amount_cents bigint not null,
  status payment_intent_status not null default 'pending',
  idempotency_key uuid not null,
  -- For deposits: the single completeDeposit() transaction.
  -- For withdrawals: the initial hold transaction (always completed
  -- immediately) is referenced here; the LATER settle/reverse transaction
  -- (also always completed immediately, by design) is a second, separate
  -- wallet_transactions row this intent does not need to track by id,
  -- since its own status field is what "waiting on the provider" means.
  hold_transaction_id uuid references wallet_transactions (id),
  resulting_transaction_id uuid references wallet_transactions (id),
  payout_method_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_payment_intents_provider_ref unique (provider, provider_ref),
  constraint chk_payment_intents_amount_positive check (amount_cents > 0)
);
comment on table payment_intents is
  'Payment-layer bookkeeping for an in-flight provider interaction (deposit or withdrawal), deliberately separate from wallet_transactions, which only ever records real, immediately-completed money movement.';

create index idx_payment_intents_provider_ref on payment_intents (provider, provider_ref);
create index idx_payment_intents_status on payment_intents (status) where status = 'pending';
create index idx_payment_intents_wallet_kind on payment_intents (wallet_id, kind, status);

create trigger trg_payment_intents_updated_at before update on payment_intents
  for each row execute function fn_set_updated_at();

alter table payment_intents enable row level security;
alter table payment_intents force row level security;

create policy payment_intents_select_own on payment_intents for select using (user_id = auth.uid());
create policy payment_intents_select_staff on payment_intents for select using (is_admin());
-- No client insert/update/delete: only payment-initialize/payment-verify/
-- payment-transfer/payment-webhook (service_role) write here.
