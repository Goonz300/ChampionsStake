-- ============================================================================
-- Migration 0087: Risk Engine + Fraud Intelligence Expansion (Phase 7 AI-003)
--
-- risk_scores: a unified, explainable current-value risk score per subject.
-- subject_id is text (not uuid) because IP addresses are a valid subject
-- type and are not UUIDs -- casting every other subject's uuid to text at
-- write time is a small, deliberate cost for not needing a second table
-- shape for IP-keyed rows. No history table: factors jsonb captures the
-- "why" for the CURRENT score (same explainability bar as fraud_flags,
-- which also has no history table), and every score-changing input already
-- has its own history elsewhere (trust_score_history, fraud_flags,
-- chargebacks) -- duplicating that into a second history log was judged
-- not worth the schema weight for this milestone.
--
-- fraud_flag_type additions: match_fixing, tournament_manipulation,
-- circular_payout, bonus_abuse, referral_abuse, prize_farming, bot_activity
-- -- genuinely new detectable categories, additive per the enum's existing
-- pattern (migrations 0060, 0080).
--
-- tor_exit_nodes / datacenter_ip_ranges: repository audit (Phase 7)
-- confirmed no GeoIP/ASN/VPN provider is configured anywhere (same finding
-- migration 0080 already documented). Per the approved Phase 7 scope, VPN/
-- proxy/TOR detection uses free, no-signup-required public data instead of
-- a paid provider: the TOR Project's public bulk exit-node list (plain
-- text, refreshed by a new cron job) and cloud providers' own published IP
-- ranges (AWS/GCP/Azure/DigitalOcean each publish theirs as public JSON/
-- text, no API key required) for datacenter detection. Residential-proxy
-- detection specifically has no equivalent free data source and is NOT
-- implemented -- see docs/FRAUD_INTEGRATION.md's Phase 7 addendum for why
-- that stays a documented gap rather than a fabricated heuristic.
-- ============================================================================

create type risk_subject_type as enum (
  'player', 'wallet', 'challenge', 'tournament', 'payment', 'withdrawal',
  'organizer', 'moderator', 'device', 'ip'
);

create table risk_scores (
  id uuid primary key default gen_random_uuid(),
  subject_type risk_subject_type not null,
  subject_id text not null,
  score numeric not null check (score >= 0 and score <= 100),
  factors jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null default now(),
  computed_by text not null default 'risk-engine'
);
comment on table risk_scores is
  'Unified, explainable current risk score per subject (Phase 7 AI-003). factors jsonb records the inputs that produced the score, same explainability bar as fraud_flags.details.';

create unique index uq_risk_scores_subject on risk_scores (subject_type, subject_id);
create index idx_risk_scores_type_score on risk_scores (subject_type, score desc);

alter table risk_scores enable row level security;
alter table risk_scores force row level security;

create policy risk_scores_select_staff on risk_scores for select using (is_admin() or is_moderator());
-- No client insert/update/delete: only the ai-risk-engine Edge Function (service_role) writes here.

alter type fraud_flag_type add value if not exists 'match_fixing';
alter type fraud_flag_type add value if not exists 'tournament_manipulation';
alter type fraud_flag_type add value if not exists 'circular_payout';
alter type fraud_flag_type add value if not exists 'bonus_abuse';
alter type fraud_flag_type add value if not exists 'referral_abuse';
alter type fraud_flag_type add value if not exists 'prize_farming';
alter type fraud_flag_type add value if not exists 'bot_activity';

-- device_ip_history extension: per-login IP classification (Phase 7). Not
-- added to devices itself -- a device's risk profile varies per IP it
-- connects from, so this belongs at the same per-login granularity as the
-- rest of device_ip_history (migration 0080), not as a single aggregate
-- flag on the device. No asn/asn_org columns: same discipline migration
-- 0080 already applied -- AWS/GCP's published ranges carry CIDR + provider
-- name, not a real ASN number, and the TOR bulk list carries no ASN at
-- all. Adding columns neither real data source can populate would be
-- exactly the half-finished field that migration explicitly avoided.
alter table device_ip_history add column is_tor boolean not null default false;
alter table device_ip_history add column is_datacenter boolean not null default false;
comment on column device_ip_history.is_tor is
  'Matched against tor_exit_nodes at login time. False (not "unknown") when the lookup found no match -- absence of a positive match is the only signal this honestly supports.';
comment on column device_ip_history.is_datacenter is
  'Matched against datacenter_ip_ranges (published cloud-provider CIDR blocks) at login time.';

-- Native inet/cidr types (not text) so classification can be done with a
-- real Postgres subnet-containment operator (<<=) instead of reimplementing
-- CIDR math in application code -- more correct (handles IPv4 edge cases
-- Postgres already solved) and lets fn_classify_ip below use an index.
create table tor_exit_nodes (
  ip_address inet primary key,
  updated_at timestamptz not null default now()
);
comment on table tor_exit_nodes is
  'Bulk TOR exit-node list from the TOR Project''s public bulk-exit-list endpoint, refreshed by a scheduled job. Free, no signup -- see migration 0087 header.';

create table datacenter_ip_ranges (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  cidr cidr not null,
  updated_at timestamptz not null default now(),
  unique (provider, cidr)
);
comment on table datacenter_ip_ranges is
  'Published cloud-provider IP CIDR ranges (AWS/GCP), refreshed by a scheduled job. Used for datacenter-proxy heuristic detection (not residential proxies -- no free data source exists for that). Azure/DigitalOcean omitted: their published-range endpoints require a versioned download link that changes per release, not a stable URL -- a real gap, not laziness, documented in docs/FRAUD_INTEGRATION.md.';

create index idx_datacenter_ip_ranges_cidr on datacenter_ip_ranges using gist (cidr inet_ops);

alter table tor_exit_nodes enable row level security;
alter table tor_exit_nodes force row level security;
alter table datacenter_ip_ranges enable row level security;
alter table datacenter_ip_ranges force row level security;

create policy tor_exit_nodes_select_staff on tor_exit_nodes for select using (is_admin() or is_moderator());
create policy datacenter_ip_ranges_select_staff on datacenter_ip_ranges for select using (is_admin() or is_moderator());
-- No client writes: only the ai-ip-intelligence Edge Function (service_role, scheduled) writes here.

create function fn_classify_ip(p_ip inet)
returns table (is_tor boolean, is_datacenter boolean)
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (select 1 from tor_exit_nodes where ip_address = p_ip) as is_tor,
    exists (select 1 from datacenter_ip_ranges where p_ip <<= cidr) as is_datacenter;
$$;
comment on function fn_classify_ip is
  'Classifies an IP against the TOR exit-node list and cloud-provider datacenter ranges (Phase 7 AI-003). security definer so callers with a limited role can still classify without needing direct table grants -- read-only, no side effects.';
