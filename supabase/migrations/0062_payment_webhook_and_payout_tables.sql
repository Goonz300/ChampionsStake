-- ============================================================================
-- Migration 0062: Payment Webhook Idempotency & Payout Methods
--
-- Two justified additions:
-- 1. processed_payment_webhook_events -- the API Specification's Stripe
--    webhook description (and OpenAPI spec) has referenced a
--    "processed_webhook_events table" for idempotency since those
--    documents were written, but no table was ever created. This is
--    provider-agnostic (keyed by provider + provider's own event id) so
--    any future provider (Stripe, Flutterwave, Adyen, Wise) reuses the
--    same table without a schema change.
-- 2. payout_methods -- withdrawals via a real transfer API (Paystack
--    "Transfer Recipient") need somewhere to store which bank account a
--    payout goes to. Nothing in any prior phase collected this. Account
--    numbers are stored masked (last 4 digits only) -- the full number and
--    any provider credentials live only in the provider's own system,
--    referenced here by recipient_code, never duplicated locally.
-- ============================================================================

create table processed_payment_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  event_type text not null,
  received_at timestamptz not null default now(),
  payload jsonb not null,
  constraint uq_processed_payment_webhook_events_provider_event unique (provider, provider_event_id)
);
comment on table processed_payment_webhook_events is
  'Idempotency ledger for payment provider webhooks. A duplicate (provider, provider_event_id) is rejected by the unique constraint before any wallet effect is applied twice.';

alter table processed_payment_webhook_events enable row level security;
alter table processed_payment_webhook_events force row level security;
create policy processed_payment_webhook_events_select_admin on processed_payment_webhook_events for select using (is_admin());
-- No client insert/update/delete: only the payment-webhook Edge Function
-- (service_role) writes here.

create table payout_methods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  provider text not null,
  recipient_code text not null, -- the provider's own reference (e.g. Paystack transfer recipient code) -- no bank credentials stored locally
  bank_code text not null,
  account_number_last4 text not null,
  account_name text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  constraint uq_payout_methods_provider_recipient unique (provider, recipient_code)
);
comment on table payout_methods is
  'References to provider-side transfer recipients for withdrawals. Only a masked account number is stored locally; the provider (Paystack) holds the actual bank details.';

create index idx_payout_methods_user_id on payout_methods (user_id);

alter table payout_methods enable row level security;
alter table payout_methods force row level security;

create policy payout_methods_select_own on payout_methods for select using (user_id = auth.uid());
create policy payout_methods_select_staff on payout_methods for select using (is_admin() or is_support());
-- No client insert/update/delete: creating a payout method requires a live
-- call to the provider's recipient-creation API (to validate the bank
-- account server-side before trusting it) -- always via the
-- payment-transfer Edge Function (service_role), never a direct table write.
