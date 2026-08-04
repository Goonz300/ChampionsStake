-- ============================================================================
-- Migration 0055: Announcements Table
--
-- SCOPE NOTE: nothing in DB-001 through REALTIME-001 has a home for
-- admin-authored platform-wide notices (maintenance notices, emergency
-- messages, tournament announcements) — `notifications` (DB-001) is
-- per-user and event-driven, not admin-authored broadcast content. This is
-- the one justified schema addition this phase needs.
-- ============================================================================

create type announcement_category as enum ('platform_notice', 'maintenance', 'tournament', 'emergency');
create type announcement_status as enum ('draft', 'published', 'expired', 'retracted');

create table announcements (
  id uuid primary key default gen_random_uuid(),
  category announcement_category not null,
  title text not null,
  body text not null,
  status announcement_status not null default 'draft',
  created_by uuid not null references profiles (id),
  published_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table announcements is
  'Admin-authored platform-wide notices, distinct from the per-user, event-driven notifications table (DB-001).';

create index idx_announcements_status_published_at on announcements (status, published_at desc);

create trigger trg_announcements_updated_at before update on announcements
  for each row execute function fn_set_updated_at();

alter table announcements enable row level security;
alter table announcements force row level security;

-- Published, non-expired announcements are readable by everyone, including
-- anonymous visitors (a maintenance notice needs to be visible pre-login).
create policy announcements_select_published on announcements
  for select
  using (status = 'published' and (expires_at is null or expires_at > now()));

create policy announcements_select_admin on announcements
  for select
  using (is_admin());

create policy announcements_write_admin on announcements
  for all
  using (is_admin())
  with check (is_admin());
