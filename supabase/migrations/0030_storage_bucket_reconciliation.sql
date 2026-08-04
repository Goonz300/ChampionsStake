-- ============================================================================
-- Migration 0030: Storage Bucket Reconciliation (DB-002 -> STORE-001)
--
-- RECONCILIATION NOTE: DB-002 (migration 0026) created 5 buckets (avatars,
-- chat-media, proofs, kyc, tournament-assets) as a minimal set needed to
-- write meaningful RLS policies at the time. This phase's brief specifies a
-- more granular 9-bucket model. Rather than layering a second, inconsistent
-- naming scheme on top, this migration reconciles the two:
--   avatars            -> unchanged
--   chat-media         -> unchanged (text/image/voice inline chat attachments)
--   tournament-assets  -> unchanged
--   proofs             -> split into proof-images + proof-videos (dispute
--                         evidence has different size/type needs per media
--                         kind; DB-001's dispute_evidence.evidence_type enum
--                         already distinguishes image/video/text/voice)
--   kyc                -> replaced by kyc-documents (name-only change, this
--                         is a greenfield project with no live uploads yet,
--                         so the old bucket is dropped rather than migrated)
--   (new)              -> challenge-media: general match screenshots/clips
--                         uploaded during a live match (challenge_attachments
--                         table), distinct from formal dispute proof
--   (new)              -> voice-notes: split out from chat-media so voice
--                         messages get their own size/retention profile
--                         instead of sharing chat-media's general-purpose one
--   (new)              -> system-assets: platform-owned assets (logos, email
--                         template images) — admin-only write, public read
-- ============================================================================

-- Drop the old kyc bucket's policies and the bucket itself (no live data to
-- preserve in this greenfield project).
drop policy if exists kyc_owner_write on storage.objects;
drop policy if exists kyc_owner_or_admin_read on storage.objects;
delete from storage.buckets where id = 'kyc';

-- Drop the old single "proofs" bucket's policies and bucket (split below).
drop policy if exists proofs_participant_write on storage.objects;
drop policy if exists proofs_participant_read on storage.objects;
delete from storage.buckets where id = 'proofs';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('challenge-media', 'challenge-media', false, 104857600,
    array['image/jpeg', 'image/png', 'image/webp', 'video/mp4']),
  ('proof-images', 'proof-images', false, 20971520,
    array['image/jpeg', 'image/png', 'image/webp']),
  ('proof-videos', 'proof-videos', false, 209715200,
    array['video/mp4', 'video/quicktime']),
  ('voice-notes', 'voice-notes', false, 5242880,
    array['audio/mpeg', 'audio/mp4', 'audio/webm']),
  ('kyc-documents', 'kyc-documents', false, 20971520,
    array['image/jpeg', 'image/png', 'application/pdf']),
  ('system-assets', 'system-assets', true, 10485760,
    array['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'])
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Path conventions (all enforced by the policies below via
-- storage.foldername()):
--   avatars/{user_id}/{filename}
--   chat-media/{challenge_id}/{filename}
--   voice-notes/{challenge_id}/{filename}
--   challenge-media/{challenge_id}/{filename}
--   proof-images/{dispute_id}/{filename}
--   proof-videos/{dispute_id}/{filename}
--   kyc-documents/{user_id}/{filename}
--   tournament-assets/{tournament_id}/{filename}
--   system-assets/{category}/{filename}   (category is a fixed admin-chosen
--                                          folder name, not a user/entity id)
-- ---------------------------------------------------------------------------

-- challenge-media: participants of that challenge only.
create policy challenge_media_participant_read on storage.objects
  for select
  using (
    bucket_id = 'challenge-media'
    and (
      is_challenge_participant(((storage.foldername(name))[1])::uuid)
      or is_moderator()
    )
  );

create policy challenge_media_participant_write on storage.objects
  for insert
  with check (
    bucket_id = 'challenge-media'
    and is_challenge_participant(((storage.foldername(name))[1])::uuid)
  );
-- No update/delete: match media is immutable once uploaded, same reasoning
-- as chat-media and proof buckets.

-- voice-notes: same participant model as chat-media.
create policy voice_notes_participant_read on storage.objects
  for select
  using (
    bucket_id = 'voice-notes'
    and (
      is_challenge_participant(((storage.foldername(name))[1])::uuid)
      or (is_moderator() and exists (
        select 1 from disputes where challenge_id = ((storage.foldername(name))[1])::uuid
      ))
    )
  );

create policy voice_notes_participant_write on storage.objects
  for insert
  with check (
    bucket_id = 'voice-notes'
    and is_challenge_participant(((storage.foldername(name))[1])::uuid)
  );

-- proof-images / proof-videos: same dispute-participant model as the old
-- combined "proofs" bucket, just split by media kind.
create policy proof_images_participant_read on storage.objects
  for select
  using (
    bucket_id = 'proof-images'
    and (is_dispute_participant(((storage.foldername(name))[1])::uuid) or is_moderator())
  );

create policy proof_images_participant_write on storage.objects
  for insert
  with check (
    bucket_id = 'proof-images'
    and can_submit_proof(((storage.foldername(name))[1])::uuid)
  );

create policy proof_videos_participant_read on storage.objects
  for select
  using (
    bucket_id = 'proof-videos'
    and (is_dispute_participant(((storage.foldername(name))[1])::uuid) or is_moderator())
  );

create policy proof_videos_participant_write on storage.objects
  for insert
  with check (
    bucket_id = 'proof-videos'
    and can_submit_proof(((storage.foldername(name))[1])::uuid)
  );
-- No update/delete on either — "moderators may review evidence but not
-- alter it", and neither may the submitting participant once it's in.

-- kyc-documents: owner + admin only (not moderators — same reasoning as the
-- old kyc bucket in DB-002).
create policy kyc_documents_owner_or_admin_read on storage.objects
  for select
  using (
    bucket_id = 'kyc-documents'
    and ((storage.foldername(name))[1] = auth.uid()::text or is_admin())
  );

create policy kyc_documents_owner_write on storage.objects
  for insert
  with check (
    bucket_id = 'kyc-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
-- No update/delete: a rejected verification requires a new submission, not
-- an edit of the old one (preserves a clean verification history).

-- system-assets: public read, admin-only write.
create policy system_assets_public_read on storage.objects
  for select
  using (bucket_id = 'system-assets');

create policy system_assets_admin_write on storage.objects
  for insert
  with check (bucket_id = 'system-assets' and is_admin());

create policy system_assets_admin_update on storage.objects
  for update
  using (bucket_id = 'system-assets' and is_admin())
  with check (bucket_id = 'system-assets' and is_admin());

create policy system_assets_admin_delete on storage.objects
  for delete
  using (bucket_id = 'system-assets' and is_admin());
