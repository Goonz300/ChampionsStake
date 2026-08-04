-- Rollback 0026: Storage Buckets & Policies
drop policy if exists tournament_assets_admin_delete on storage.objects;
drop policy if exists tournament_assets_admin_update on storage.objects;
drop policy if exists tournament_assets_admin_write on storage.objects;
drop policy if exists tournament_assets_public_read on storage.objects;
drop policy if exists kyc_owner_write on storage.objects;
drop policy if exists kyc_owner_or_admin_read on storage.objects;
drop policy if exists proofs_participant_write on storage.objects;
drop policy if exists proofs_participant_read on storage.objects;
drop policy if exists chat_media_participant_write on storage.objects;
drop policy if exists chat_media_participant_read on storage.objects;
drop policy if exists avatars_owner_delete on storage.objects;
drop policy if exists avatars_owner_update on storage.objects;
drop policy if exists avatars_owner_write on storage.objects;
drop policy if exists avatars_public_read on storage.objects;

-- Buckets are left in place on rollback (deleting a storage bucket also
-- deletes any objects already uploaded to it — far too destructive for an
-- automatic rollback script). Remove manually via the Supabase dashboard if
-- truly needed.
