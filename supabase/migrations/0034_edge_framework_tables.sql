-- ============================================================================
-- Migration 0034: Edge Function Framework Support Tables
-- Tables: idempotency_keys, domain_events
--
-- SCOPE NOTE: this phase builds shared infrastructure with "no business
-- logic", but two of its explicit requirements (a generic Idempotency
-- Framework, and an internal Event Bus) have no durable home in the
-- existing schema — wallet_transactions.idempotency_key (DB-001) is
-- wallet-specific, and there is no event log at all. Both tables below are
-- generic (no column references a specific business domain), so they don't
-- pre-empt the Wallet/Escrow/Challenge phases that come next; they exist so
-- ANY future Edge Function can use idempotency/eventing without those
-- phases each reinventing it.
-- ============================================================================

create type idempotency_status as enum ('in_progress', 'completed', 'failed');

create table idempotency_keys (
  key uuid primary key,
  request_fingerprint text not null, -- hash of (endpoint + normalized body), detects a reused key with a DIFFERENT payload
  status idempotency_status not null default 'in_progress',
  response_status_code int,
  response_body jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  expires_at timestamptz not null default (now() + interval '24 hours')
);
comment on table idempotency_keys is
  'Generic idempotency store for any Edge Function (Readiness Report Critical #2). Keyed by client-supplied UUID; request_fingerprint detects key reuse with a different payload, which is rejected rather than silently replayed.';

create index idx_idempotency_keys_expires_at on idempotency_keys (expires_at);

-- domain_events ---------------------------------------------------------
-- Durable event log. IMPORTANT DESIGN NOTE: Edge Functions are stateless,
-- short-lived serverless invocations — there is no long-running process to
-- hold in-memory event subscribers across invocations. This table is
-- therefore the actual "bus": emitting an event means durably recording it
-- here; fan-out to interested consumers (e.g. a future notification
-- dispatcher) means something else durably reads this table (a scheduled
-- job, a Postgres trigger, or Realtime on this table), not an in-process
-- subscriber list. See EDGE_FUNCTIONS.md's Event Bus section for the full
-- explanation of why this isn't a typical in-memory pub/sub.
create table domain_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  correlation_id text,
  emitted_by text, -- Edge Function name that emitted it, for tracing
  created_at timestamptz not null default now(),
  processed_at timestamptz -- set by a future consumer; null = not yet handled
);
comment on table domain_events is
  'Durable event log emitted by Edge Functions (e.g. ChallengeCreated, EscrowLocked). Not an in-memory bus — see table comment/EDGE_FUNCTIONS.md for why that would not survive across serverless invocations.';

create index idx_domain_events_type_created_at on domain_events (event_type, created_at);
create index idx_domain_events_unprocessed on domain_events (created_at) where processed_at is null;
create index idx_domain_events_correlation_id on domain_events (correlation_id) where correlation_id is not null;

-- Both tables are backend-infrastructure-only: enable + force RLS with NO
-- policies at all, so only service_role (which bypasses RLS) can touch
-- them. No authenticated/anon user should ever query these directly.
alter table idempotency_keys enable row level security;
alter table idempotency_keys force row level security;
alter table domain_events enable row level security;
alter table domain_events force row level security;
