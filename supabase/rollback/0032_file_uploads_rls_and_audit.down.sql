-- Rollback 0032: file_uploads RLS + Audit Mirror
drop trigger if exists trg_audit_file_upload on file_uploads;
drop function if exists fn_audit_file_upload();
drop policy if exists file_uploads_select_related_dispute on file_uploads;
drop policy if exists file_uploads_select_related_challenge on file_uploads;
drop policy if exists file_uploads_select_staff on file_uploads;
drop policy if exists file_uploads_select_own on file_uploads;
