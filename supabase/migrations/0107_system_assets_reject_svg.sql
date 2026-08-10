-- 0107_system_assets_reject_svg.sql
--
-- Phase 8.5 hostile-review finding (Medium): the system-assets bucket
-- (public, admin-only write, migration 0030) allowed image/svg+xml, but
-- neither this bucket's server-side validation (apps/web/lib/storage/
-- validation.ts's MAGIC_BYTES table) nor image-processing.ts's threat
-- scanner (an honestly-documented no-op) actually inspects SVG content.
-- An SVG containing <script> executes if a browser navigates to it
-- directly -- a stored-script-hosting vector on a public, trusted-looking
-- *.supabase.co URL. Scoped to admin accounts only (system-assets write
-- requires is_admin()), but a real, concrete gap, not theoretical.
--
-- Fix: remove image/svg+xml from the bucket's allowed_mime_types at the
-- Supabase Storage level (defense in depth alongside the matching
-- application-level fix in apps/web/lib/storage/config.ts). Admin-owned
-- logo/icon assets remain uploadable as PNG/WEBP, both of which DO have
-- real magic-byte content validation.
update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'system-assets';
