-- ============================================================================
-- Migration 0032: file_uploads RLS + Audit Mirror
-- ============================================================================

alter table file_uploads enable row level security;
alter table file_uploads force row level security;

create policy file_uploads_select_own on file_uploads
  for select
  using (owner_id = auth.uid());

create policy file_uploads_select_staff on file_uploads
  for select
  using (is_admin() or is_moderator());

-- Participant/dispute visibility for shared media (chat/challenge/proof
-- uploads someone else owns but this user has a legitimate reason to see) —
-- narrower than "select_staff", mirrors the same helper functions the
-- storage.objects policies use so the two layers never disagree with each
-- other about who can see a given file.
create policy file_uploads_select_related_challenge on file_uploads
  for select
  using (
    related_table = 'challenges'
    and related_id is not null
    and is_challenge_participant(related_id::uuid)
  );

create policy file_uploads_select_related_dispute on file_uploads
  for select
  using (
    related_table = 'disputes'
    and related_id is not null
    and is_dispute_participant(related_id::uuid)
  );

-- No direct client INSERT/UPDATE/DELETE: every row is written by the media
-- service layer (lib/storage/*.ts) using the service-role client, in the
-- same request that performs the actual Storage API upload — metadata and
-- file existence must never be allowed to drift apart by letting a client
-- write one without the other.

-- ---------------------------------------------------------------------------
-- Audit mirror: every upload and every soft-delete gets an audit_logs row.
-- Download/permission-failure logging happens at the service layer (see
-- STORE-001-deliverable.md's honesty note — Storage API downloads via signed
-- URL do not pass through Postgres at all, so a DB trigger structurally
-- cannot observe them; this mirrors the same limitation DB-002 documented
-- for RLS SELECT denials).
-- ---------------------------------------------------------------------------

create or replace function fn_audit_file_upload()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    perform fn_write_audit_log(
      new.owner_id, 'user'::actor_type, 'FileUploaded', 'system'::audit_action_category,
      'file_uploads', new.id::text,
      jsonb_build_object('bucket', new.bucket, 'mime_type', new.mime_type, 'size_bytes', new.file_size_bytes)
    );
  elsif tg_op = 'UPDATE' and new.status = 'deleted' and old.status <> 'deleted' then
    perform fn_write_audit_log(
      auth.uid(), case when is_admin() then 'administrator' when is_moderator() then 'moderator' else 'user' end::actor_type,
      'FileDeleted', 'system'::audit_action_category,
      'file_uploads', new.id::text,
      jsonb_build_object('bucket', new.bucket)
    );
  end if;
  return new;
end;
$$;

create trigger trg_audit_file_upload
  after insert or update on file_uploads
  for each row execute function fn_audit_file_upload();
