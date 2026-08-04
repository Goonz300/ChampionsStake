-- ============================================================================
-- Migration 0010: Audit & Feature Flag Tables
-- Tables: audit_logs, feature_flags
-- ============================================================================

-- audit_logs ------------------------------------------------------------
-- System-wide, append-only event log. actor_id is nullable to support
-- system-triggered events (e.g. auto-expiry) with no human actor — a gap the
-- Readiness Report flagged explicitly (Missing Backend Components §9).
create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references profiles (id),
  actor_type actor_type not null default 'system',
  action text not null, -- System Event name, Business Rules §18
  category audit_action_category not null,
  target_table text not null,
  target_id text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
comment on table audit_logs is
  'System-wide append-only audit trail. actor_id is nullable for system-triggered events. Never updated or deleted.';

create index idx_audit_logs_actor_id on audit_logs (actor_id) where actor_id is not null;
create index idx_audit_logs_action on audit_logs (action);
create index idx_audit_logs_category_created_at on audit_logs (category, created_at desc);
create index idx_audit_logs_target on audit_logs (target_table, target_id);

-- feature_flags -----------------------------------------------------------
create table feature_flags (
  key text primary key,
  description text not null,
  enabled boolean not null default false,
  requires_dual_approval boolean not null default false,
  pending_approval_by uuid references profiles (id),
  updated_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table feature_flags is
  'Platform feature flags. Money-affecting flags (requires_dual_approval=true) need a second admin''s sign-off (Business Rules §11).';
