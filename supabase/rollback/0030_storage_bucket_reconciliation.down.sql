-- Rollback 0030: Storage Bucket Reconciliation
drop policy if exists system_assets_admin_delete on storage.objects;
drop policy if exists system_assets_admin_update on storage.objects;
drop policy if exists system_assets_admin_write on storage.objects;
drop policy if exists system_assets_public_read on storage.objects;
drop policy if exists kyc_documents_owner_write on storage.objects;
drop policy if exists kyc_documents_owner_or_admin_read on storage.objects;
drop policy if exists proof_videos_participant_write on storage.objects;
drop policy if exists proof_videos_participant_read on storage.objects;
drop policy if exists proof_images_participant_write on storage.objects;
drop policy if exists proof_images_participant_read on storage.objects;
drop policy if exists voice_notes_participant_write on storage.objects;
drop policy if exists voice_notes_participant_read on storage.objects;
drop policy if exists challenge_media_participant_write on storage.objects;
drop policy if exists challenge_media_participant_read on storage.objects;

-- Buckets left in place (deleting one also deletes its objects — too
-- destructive for an automatic rollback). Restoring the old 'proofs'/'kyc'
-- buckets and their policies, if truly needed, means re-running DB-002's
-- migration 0026 storage section manually.
