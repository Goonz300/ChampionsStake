-- ============================================================================
-- Migration 0072: Session/Device Context Columns
--
-- Phase 3B (Session & Device Management), per the approved Phase 3
-- Architecture Rev. 2, §8/§12. Additive only -- no existing migration,
-- table, enum, function, or RLS policy touched.
--
-- SCOPE NOTE: the architecture's §8 also lists user_sessions.ip_address/
-- user_agent as missing columns. Verified against the actual repository
-- before writing this migration (per this phase's own audit-first rule):
-- both already exist on user_sessions (migration 0003) and are already
-- written by lib/auth/session-registry.ts's recordSession. That part of
-- the architecture document is stale and is not re-applied here -- only
-- the two columns confirmed genuinely absent are added below.
-- ============================================================================

alter table devices add column user_agent text;
comment on column devices.user_agent is
  'Raw User-Agent string, added because device_fingerprint (0003) is a one-way SHA-256 hash and cannot be turned into a human-readable device label ("Chrome on Windows") on its own. Null for devices recorded before this migration.';

alter table user_sessions add column device_id uuid references devices (id) on delete set null;
comment on column user_sessions.device_id is
  'Links a session to the device that created it. user_sessions and devices were written independently at login (0003) with no relationship between them -- this is required to show "N sessions from this device" without joining on the derived fingerprint. Null for sessions recorded before this migration and for any session whose device lookup fails (ON DELETE SET NULL, not CASCADE, since a session should not disappear if its device row is ever removed).';

create index idx_user_sessions_device_id on user_sessions (device_id) where device_id is not null;
