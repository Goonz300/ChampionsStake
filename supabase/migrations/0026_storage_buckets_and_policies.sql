-- ============================================================================
-- Migration 0026: Storage Buckets & Policies
--
-- SCOPE NOTE: creating the 5 buckets themselves is technically Roadmap Phase
-- 4 (STOR-001/STOR-002) rather than this security phase, but Step 5 of this
-- brief explicitly asks to secure these named buckets — securing a bucket
-- that doesn't exist yet is meaningless, so the buckets are created here
-- (storage.buckets is Supabase infrastructure metadata, not a change to the
-- ChampionsStake application schema from DB-001). Path convention for every
-- bucket is documented in each policy's comment below.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars', 'avatars', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('chat-media', 'chat-media', false, 104857600, array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'audio/mpeg', 'audio/mp4']),
  ('proofs', 'proofs', false, 104857600, array['image/jpeg', 'image/png', 'image/webp', 'video/mp4']),
  ('kyc', 'kyc', false, 20971520, array['image/jpeg', 'image/png', 'application/pdf']),
  ('tournament-assets', 'tournament-assets', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- avatars: path convention avatars/{user_id}/{filename}. Public bucket
-- (readable by anyone, per Architecture's public-read avatars decision) but
-- upload restricted to the owning folder.
create policy avatars_public_read on storage.objects
  for select
  using (bucket_id = 'avatars');

create policy avatars_owner_write on storage.objects
  for insert
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy avatars_owner_update on storage.objects
  for update
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy avatars_owner_delete on storage.objects
  for delete
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- chat-media: path convention chat-media/{challenge_id}/{filename}. Private
-- — readable/writable only by that challenge's participants (or a moderator
-- once a dispute exists on that challenge).
create policy chat_media_participant_read on storage.objects
  for select
  using (
    bucket_id = 'chat-media'
    and (
      is_challenge_participant(((storage.foldername(name))[1])::uuid)
      or (is_moderator() and exists (
        select 1 from disputes where challenge_id = ((storage.foldername(name))[1])::uuid
      ))
    )
  );

create policy chat_media_participant_write on storage.objects
  for insert
  with check (
    bucket_id = 'chat-media'
    and is_challenge_participant(((storage.foldername(name))[1])::uuid)
  );

-- No update/delete: chat media, like chat messages, is immutable once sent.

-- proofs: path convention proofs/{dispute_id}/{filename}. Private —
-- submitted only by dispute participants, reviewed (read) by participants
-- and moderators, altered by no one once uploaded.
create policy proofs_participant_read on storage.objects
  for select
  using (
    bucket_id = 'proofs'
    and (
      is_dispute_participant(((storage.foldername(name))[1])::uuid)
      or is_moderator()
    )
  );

create policy proofs_participant_write on storage.objects
  for insert
  with check (
    bucket_id = 'proofs'
    and can_submit_proof(((storage.foldername(name))[1])::uuid)
  );

-- No update/delete: "moderators may review evidence but not alter it", and
-- neither may the submitting participant once it's in.

-- kyc: path convention kyc/{user_id}/{filename}. Private, owner + admin only
-- (not even moderators — KYC documents are more sensitive than dispute
-- evidence; only admins handle identity verification overrides, Business
-- Rules §11).
create policy kyc_owner_or_admin_read on storage.objects
  for select
  using (
    bucket_id = 'kyc'
    and ((storage.foldername(name))[1] = auth.uid()::text or is_admin())
  );

create policy kyc_owner_write on storage.objects
  for insert
  with check (
    bucket_id = 'kyc'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- No update/delete: once submitted, a KYC document is not edited in place —
-- a rejected verification requires a new submission (new file), not a
-- mutation of the old one, preserving a clean verification history.

-- tournament-assets: path convention tournament-assets/{tournament_id}/{filename}.
-- Public read (banners/branding), admin-only write.
create policy tournament_assets_public_read on storage.objects
  for select
  using (bucket_id = 'tournament-assets');

create policy tournament_assets_admin_write on storage.objects
  for insert
  with check (bucket_id = 'tournament-assets' and is_admin());

create policy tournament_assets_admin_update on storage.objects
  for update
  using (bucket_id = 'tournament-assets' and is_admin())
  with check (bucket_id = 'tournament-assets' and is_admin());

create policy tournament_assets_admin_delete on storage.objects
  for delete
  using (bucket_id = 'tournament-assets' and is_admin());
