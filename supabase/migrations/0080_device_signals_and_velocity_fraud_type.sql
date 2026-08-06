-- ============================================================================
-- Migration 0080: Device Signal Expansion + Velocity Fraud Flag Type
--
-- Phase 5 (Enterprise Rate Limiting & Attack Mitigation), Layers 5-6.
-- Purely additive -- no existing migration, table, enum, function, or RLS
-- policy touched.
--
-- DEVICE SIGNALS: "expand existing device infrastructure" (devices table,
-- migration 0003) with the IP-history and country signals this phase's
-- Layer 5 names, WITHOUT fabricating unpopulated columns for signals this
-- environment has no real source for. Verified before writing this: no
-- GeoIP/ASN provider is configured anywhere in this repo (no MaxMind/ipapi/
-- similar integration exists) and no client sends a timezone header today --
-- adding asn/timezone columns nobody would ever populate would be exactly
-- the kind of half-finished field this codebase's own conventions avoid.
-- country_code IS added because it has a genuine, free source under this
-- phase's own Layer 1 assumption: Cloudflare (or an equivalent edge/CDN)
-- sets CF-IPCountry on every request that passes through it, no external
-- API call required. Degrades to null when not deployed behind Cloudflare
-- -- an honest gap, not a fabricated value.
--
-- device_ip_history is a genuine login-time log (one row per login, not
-- just first-seen), separate from devices.last_ip_address (most-recent
-- only) -- multi-account/account-farming detection needs to see the full
-- recent IP set for a device, not just its latest one.
-- ============================================================================

alter table devices add column last_ip_address text;
comment on column devices.last_ip_address is
  'Most recent IP address seen for this device fingerprint. Null for devices recorded before this migration.';

alter table devices add column country_code text;
comment on column devices.country_code is
  'ISO 3166-1 alpha-2, from the CF-IPCountry header when the deployment sits behind Cloudflare (Layer 1 assumption). Null when not present -- no external GeoIP lookup is performed.';

create table device_ip_history (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references devices (id) on delete cascade,
  ip_address text not null,
  country_code text,
  seen_at timestamptz not null default now()
);
comment on table device_ip_history is
  'One row per login for a device (not just first-seen) -- supports "IP history" (Layer 5) and shared-IP/account-farming velocity checks (Layer 6), which need the recent IP set for a device, not just devices.last_ip_address''s single most-recent value.';

create index idx_device_ip_history_device_id on device_ip_history (device_id, seen_at desc);
create index idx_device_ip_history_ip_address on device_ip_history (ip_address, seen_at desc);

alter table device_ip_history enable row level security;
alter table device_ip_history force row level security;

-- Same no-client-write posture as devices itself: only recorded server-side
-- at login (service_role). Owner can read their own device's IP history
-- (mirrors devices' own devices_select_self_or_staff policy, migration
-- 0018); staff can read all for fraud investigation.
create policy device_ip_history_select_own on device_ip_history for select using (
  device_id in (select id from devices where user_id = auth.uid())
);
create policy device_ip_history_select_staff on device_ip_history for select using (is_admin() or is_moderator());

-- VELOCITY FRAUD FLAG TYPE ---------------------------------------------
-- fraud_flag_type (migration 0060) already had 'suspicious_withdrawal' and
-- 'suspicious_deposit' values that were never actually raised by any
-- function (verified by grep before writing this -- _ai/fraud-detection.ts
-- only ever raises 'collusion'/'multi_account'/'repeated_opponent'). This
-- phase's velocity checks (withdrawal velocity) wire up
-- 'suspicious_withdrawal' for the first time rather than inventing a
-- parallel type. 'velocity_abuse' is new -- covers the velocity signals
-- that don't already have a dedicated type (rapid challenge creation,
-- tournament registration spam), distinguished via details->>'signal'
-- rather than adding a new enum value per signal.
alter type fraud_flag_type add value if not exists 'velocity_abuse';
