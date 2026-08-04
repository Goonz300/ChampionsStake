-- ============================================================================
-- Migration 0031: File Uploads Metadata Table
--
-- SCOPE NOTE: this phase's "Database Integration" section explicitly
-- requires storing owner/bucket/path/type/size/checksum/timestamp/related-
-- entity/visibility/status metadata for every upload — none of DB-001's 29
-- tables cover this (challenge_attachments and dispute_evidence store a
-- storage_path but none of the other fields, and neither covers avatars,
-- voice notes, or system assets). This table is the justified schema
-- addition closing that gap, and is deliberately generic (covers all 9
-- buckets) rather than duplicating similar columns across every existing
-- media-referencing table.
-- ============================================================================

create type file_upload_status as enum ('pending', 'active', 'quarantined', 'deleted');
create type file_upload_visibility as enum ('public', 'private');
create type storage_bucket_name as enum (
  'avatars', 'challenge-media', 'proof-images', 'proof-videos',
  'chat-media', 'voice-notes', 'kyc-documents', 'tournament-assets', 'system-assets'
);

create table file_uploads (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles (id) on delete restrict,
  bucket storage_bucket_name not null,
  storage_path text not null,
  mime_type text not null,
  file_size_bytes bigint not null,
  checksum_sha256 text not null,
  -- Loosely-typed polymorphic reference (mirrors audit_logs' target_table/
  -- target_id pattern from DB-001) rather than one nullable FK column per
  -- possible related entity (challenge/dispute/tournament/none-for-avatars).
  related_table text,
  related_id text,
  visibility file_upload_visibility not null default 'private',
  status file_upload_status not null default 'pending',
  original_filename text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint uq_file_uploads_bucket_path unique (bucket, storage_path),
  constraint chk_file_uploads_size_positive check (file_size_bytes > 0),
  constraint chk_file_uploads_checksum_format check (checksum_sha256 ~ '^[0-9a-f]{64}$')
);
comment on table file_uploads is
  'Metadata for every file uploaded to any of the 9 storage buckets: owner, checksum, related entity, visibility, and lifecycle status. The storage.objects row is the actual file; this row is what the application queries to reason about it without hitting the Storage API.';

create index idx_file_uploads_owner_id on file_uploads (owner_id);
create index idx_file_uploads_bucket_status on file_uploads (bucket, status);
create index idx_file_uploads_related on file_uploads (related_table, related_id) where related_table is not null;
create index idx_file_uploads_checksum on file_uploads (checksum_sha256);
create index idx_file_uploads_status_created_at on file_uploads (status, created_at) where status in ('pending', 'quarantined');

create trigger trg_file_uploads_updated_at before update on file_uploads
  for each row execute function fn_set_updated_at();
