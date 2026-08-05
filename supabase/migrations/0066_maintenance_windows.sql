-- ============================================================================
-- Migration 0066: Maintenance Windows
--
-- SCOPE NOTE (Phase 2 gap audit): `announcements` (0055) already covers
-- free-text admin broadcasts, including an announcement_category of
-- 'maintenance' — but it has no structured start/end/affected-services/
-- status fields, so nothing (e.g. an admin-system-health dashboard) can
-- query "is there maintenance active on service X right now". This table
-- is the structured operational record; announcements remains the
-- user-facing broadcast text. The two are deliberately separate, same
-- relationship DB-001's notifications has to 0055's announcements.
-- ============================================================================

-- Closed set of exactly two values -- a genuine enum, not text.
create type maintenance_schedule_type as enum ('planned', 'emergency');

create type maintenance_window_status as enum ('scheduled', 'in_progress', 'completed', 'cancelled');

create table maintenance_windows (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  -- Free text, not an enum: the set of maintainable subsystems grows with
  -- the platform (same reasoning migration 0002 gives for audit_logs.action)
  -- and doesn't need a schema migration every time a new one is named.
  maintenance_type text not null,
  schedule_type maintenance_schedule_type not null default 'planned',
  affected_services text[] not null default '{}',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status maintenance_window_status not null default 'scheduled',
  created_by uuid not null references profiles (id),
  updated_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_maintenance_windows_end_after_start check (ends_at > starts_at)
);
comment on table maintenance_windows is
  'Structured maintenance scheduling record (title/type/affected services/window/status), distinct from the free-text announcements table (0055) used for the user-facing notice.';

create index idx_maintenance_windows_status_starts_at on maintenance_windows (status, starts_at);
create index idx_maintenance_windows_active on maintenance_windows (starts_at, ends_at) where status in ('scheduled', 'in_progress');

create trigger trg_maintenance_windows_updated_at before update on maintenance_windows
  for each row execute function fn_set_updated_at();

alter table maintenance_windows enable row level security;
alter table maintenance_windows force row level security;

-- Mirrors announcements' exact posture (0055): scheduled/in-progress
-- windows are readable by everyone, including pre-login anonymous
-- visitors, since a maintenance banner needs to be visible before auth.
create policy maintenance_windows_select_public on maintenance_windows
  for select
  using (status in ('scheduled', 'in_progress'));

create policy maintenance_windows_select_admin on maintenance_windows
  for select
  using (is_admin());

create policy maintenance_windows_write_admin on maintenance_windows
  for all
  using (is_admin())
  with check (is_admin());
