-- ============================================================================
-- Migration 0065: Notification Infrastructure (Push Tokens, Email Queue,
-- Notification Templates)
--
-- SCOPE NOTE (Phase 2 gap audit): DB-001/0008 created the in-app
-- `notifications` feed and `notification_categories` (0052) added
-- filterable categories, but nothing delivers a notification OUTSIDE the
-- app — no device push, no email. This migration adds the three tables
-- needed for that: where a device's push token lives, what an email/push
-- template looks like, and a durable outbound email queue with retry
-- tracking. It does not add a push/email SENDER (that's Edge Function
-- work, out of this phase's DB-only scope) — these tables are the durable
-- state a future sender would read from and write status back to.
-- ============================================================================

-- push_provider: the four channels named in this phase's requirements.
-- Kept as an enum (not text) because, unlike audit_logs.action, this is a
-- genuinely closed set — a new push channel is rare enough, and consequential
-- enough (different token format/validation per provider), to warrant a
-- real migration when it happens rather than silently accepting anything.
create type push_provider as enum ('fcm', 'apns', 'expo', 'web_push');

create table push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  device_id uuid references devices (id) on delete set null,
  provider push_provider not null,
  token text not null,
  is_active boolean not null default true,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_push_tokens_provider_token unique (provider, token)
);
comment on table push_tokens is
  'Registered device push tokens (FCM/APNs/Expo/Web Push). One row per token; device_id links back to the existing devices table (0003) when known. A sender Edge Function reads is_active tokens per user and should flip is_active=false on a provider-reported invalid-token response rather than deleting the row.';

create index idx_push_tokens_user_id_active on push_tokens (user_id) where is_active = true;

create trigger trg_push_tokens_updated_at before update on push_tokens
  for each row execute function fn_set_updated_at();

alter table push_tokens enable row level security;
alter table push_tokens force row level security;

-- A device registers/deregisters its own token directly (standard mobile
-- push pattern — no Edge Function round-trip needed for this).
create policy push_tokens_select_own on push_tokens for select using (user_id = auth.uid());
create policy push_tokens_insert_own on push_tokens for insert with check (user_id = auth.uid());
create policy push_tokens_update_own on push_tokens for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy push_tokens_delete_own on push_tokens for delete using (user_id = auth.uid());
create policy push_tokens_select_staff on push_tokens for select using (is_admin() or is_moderator());

-- notification_templates -----------------------------------------------------
-- Reuses the existing notification_category enum (0052) so a template's
-- category lines up with the same taxonomy notifications.category already
-- uses, instead of inventing a second, parallel classification.
create table notification_templates (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  category notification_category not null,
  description text,
  push_title_template text,
  push_body_template text,
  email_subject_template text,
  email_body_html_template text,
  email_body_text_template text,
  variables jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_notification_templates_has_content check (
    push_title_template is not null or email_subject_template is not null
  )
);
comment on table notification_templates is
  'Reusable push/email content templates, keyed by a stable `code` (e.g. challenge_invite, wallet_deposit_confirmed). `variables` documents the expected substitution keys as a jsonb array of names; substitution itself happens in the sender Edge Function, not the database.';

create index idx_notification_templates_category on notification_templates (category) where is_active = true;

create trigger trg_notification_templates_updated_at before update on notification_templates
  for each row execute function fn_set_updated_at();

alter table notification_templates enable row level security;
alter table notification_templates force row level security;

-- Templates are admin-authored content, not user data — same posture as
-- feature_flags/announcements: staff read/write, no client access at all.
create policy notification_templates_select_staff on notification_templates for select using (is_admin() or is_moderator());
create policy notification_templates_write_admin on notification_templates for all using (is_admin()) with check (is_admin());

-- email_queue -----------------------------------------------------------
-- email_provider: kept open to more than one value from day one per this
-- phase's "support email provider abstraction" requirement, even though
-- 'resend' (see apps/web CI's RESEND_API_KEY) is the only provider actually
-- wired up today.
create type email_provider as enum ('resend', 'sendgrid', 'ses');
create type email_queue_status as enum ('queued', 'processing', 'sent', 'failed');

create table email_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles (id) on delete set null,
  recipient_email text not null,
  template_id uuid references notification_templates (id),
  provider email_provider not null default 'resend',
  subject text not null,
  body_html text,
  body_text text,
  variables jsonb not null default '{}'::jsonb,
  status email_queue_status not null default 'queued',
  retry_count int not null default 0,
  max_retries int not null default 5,
  next_retry_at timestamptz,
  last_error text,
  provider_message_id text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_email_queue_retry_count_nonneg check (retry_count >= 0),
  constraint chk_email_queue_max_retries_positive check (max_retries > 0)
);
comment on table email_queue is
  'Durable outbound email queue with per-row retry tracking. user_id is nullable and ON DELETE SET NULL (not CASCADE) so a queued/sent email record survives account deletion for audit purposes even though the user reference is cleared. template_id is nullable to allow ad-hoc admin-authored emails outside the template system.';

create index idx_email_queue_status_created_at on email_queue (status, created_at) where status in ('queued', 'processing');
create index idx_email_queue_next_retry_at on email_queue (next_retry_at) where status = 'failed' and next_retry_at is not null;
create index idx_email_queue_user_id on email_queue (user_id);

create trigger trg_email_queue_updated_at before update on email_queue
  for each row execute function fn_set_updated_at();

alter table email_queue enable row level security;
alter table email_queue force row level security;

-- Backend-infrastructure-only table, same posture as domain_events/
-- idempotency_keys (0034): contains recipient email addresses and delivery
-- error detail, so no authenticated/anon policy at all — only service_role
-- (a future email-worker Edge Function) touches it.
