-- Rollback 0031: File Uploads Metadata Table
drop trigger if exists trg_file_uploads_updated_at on file_uploads;
drop table if exists file_uploads;
drop type if exists storage_bucket_name;
drop type if exists file_upload_visibility;
drop type if exists file_upload_status;
