-- ============================================================================
-- Migration 0086: Trust Engine v2 Foundation (Phase 7 AI-002)
--
-- Repository audit (Phase 7) found trust_score_history's idempotency check
-- (_ai/trust-score.ts's alreadyProcessed) keys on challenge_id, which every
-- event handled so far (match results, dispute decisions) naturally has.
-- Trust Engine v2 adds inputs with no challenge_id at all (withdrawal
-- reliability, tournament no-shows, chargebacks, sanctions hits) -- reusing
-- challenge_id for these would either violate its FK (challenges) or make
-- idempotency silently impossible to check. source_event_id (nullable,
-- references domain_events) is added instead: a generic idempotency key that
-- works for any event type without coupling trust_score_history to a
-- specific business entity, and without touching the challenge_id column
-- any existing reader depends on.
--
-- chargebacks: audit (Phase 7) confirmed transaction_type already has a
-- 'chargeback' enum value (migration 0035) that is never actually inserted
-- anywhere in the codebase -- there is no live payment-provider chargeback
-- webhook integration (same honest scoping as migration 0084's sanctions
-- blocklist: a real gap, not invented infrastructure). This table is the
-- administrator-recorded factual log of a chargeback reported by staff from
-- their payment provider's dashboard -- not a fraud suspicion (that's
-- fraud_flags' job), a confirmed financial event Trust Engine v2 reacts to.
-- ============================================================================

alter table trust_score_history
  add column source_event_id uuid references domain_events (id);

create index idx_trust_score_history_source_event on trust_score_history (source_event_id)
  where source_event_id is not null;

comment on column trust_score_history.source_event_id is
  'Generic idempotency key for non-challenge-keyed trust adjustments (Phase 7). challenge_id remains authoritative for match/dispute reasons; new reasons (withdrawal_settled, withdrawal_reversed, tournament_no_show, chargeback, sanctions_block) use this instead.';

create table chargebacks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id),
  wallet_transaction_id uuid references wallet_transactions (id),
  provider text not null,
  provider_reference text not null,
  amount_cents bigint not null check (amount_cents > 0),
  reason text not null,
  recorded_by uuid not null references profiles (id),
  created_at timestamptz not null default now()
);
comment on table chargebacks is
  'Administrator-recorded chargebacks (Phase 7 AI-002). No live provider chargeback webhook exists yet -- staff record what their payment provider dashboard shows. Feeds Trust Engine v2 and Fraud Intelligence (circular-payout/wallet-abuse detection).';

create index idx_chargebacks_user_id on chargebacks (user_id, created_at desc);
create unique index uq_chargebacks_provider_reference on chargebacks (provider, provider_reference);

alter table chargebacks enable row level security;
alter table chargebacks force row level security;

create policy chargebacks_select_staff on chargebacks for select using (is_admin() or is_moderator());
-- No client insert/update/delete policy: only the admin-wallets Edge Function (service_role) writes here.
