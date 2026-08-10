-- Rollback 0107: system-assets reject SVG
update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']
where id = 'system-assets';
