-- ============================================================================
-- Migration 0003: Core Identity Tables
-- Tables: profiles, devices, user_sessions, system_settings
-- ============================================================================

-- profiles ------------------------------------------------------------------
-- One row per Supabase Auth user (auth.users.id). Holds all ChampionsStake-
-- specific identity/trust/KYC state that Supabase Auth itself doesn't store.
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  avatar_url text,
  role user_role not null default 'player',
  status user_status not null default 'unverified',
  kyc_status kyc_status not null default 'unverified',
  kyc_provider_ref text,
  trust_score numeric not null default 1000,
  completion_rate numeric not null default 100.00,
  country_code text,
  email_verified_at timestamptz,
  suspended_at timestamptz,
  suspended_reason_code text,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_profiles_display_name_length check (char_length(display_name) between 3 and 20),
  constraint chk_profiles_trust_score_range check (trust_score >= 0),
  constraint chk_profiles_completion_rate_range check (completion_rate between 0 and 100)
);
comment on table profiles is
  'One row per authenticated user. Extends auth.users with ChampionsStake identity, trust, and KYC state (Business Rules §2).';

create unique index uq_profiles_display_name on profiles (lower(display_name));
create index idx_profiles_role on profiles (role);
create index idx_profiles_status on profiles (status);
create index idx_profiles_kyc_status on profiles (kyc_status);
create index idx_profiles_trust_score on profiles (trust_score desc);

-- devices ---------------------------------------------------------------
-- Supports multi-account/fraud detection (Business Rules §14).
create table devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  device_fingerprint text not null,
  platform text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table devices is
  'Device fingerprints observed per user, used by fraud-detection multi-account checks (Business Rules §14).';

create index idx_devices_user_id on devices (user_id);
create index idx_devices_fingerprint on devices (device_fingerprint);
create unique index uq_devices_user_fingerprint on devices (user_id, device_fingerprint);

-- user_sessions -----------------------------------------------------------
-- Server-side session/refresh-token registry, supports logout-everywhere and
-- session revocation (Architecture §8: 15-min access / 7-day refresh).
create table user_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  refresh_token_hash text not null,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  updated_at timestamptz not null default now()
);
comment on table user_sessions is
  'Server-side registry of issued refresh tokens, enabling revocation and session audit.';

create index idx_user_sessions_user_id on user_sessions (user_id);
create unique index uq_user_sessions_token_hash on user_sessions (refresh_token_hash);
create index idx_user_sessions_expires_at on user_sessions (expires_at) where revoked_at is null;

-- system_settings -----------------------------------------------------------
-- Global, admin-editable configuration values referenced throughout Business
-- Rules (stake limits, timeouts, deposit caps). Not requested as a named
-- table in the brief's Step 2 list, but explicitly requested under Step 8
-- ("Seed Data: ... System Settings") — this table is what that seed data
-- populates.
create table system_settings (
  key text primary key,
  value jsonb not null,
  description text,
  updated_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table system_settings is
  'Key/value store for platform-wide configurable limits and timeouts (Business Rules §6, §16, §19).';
