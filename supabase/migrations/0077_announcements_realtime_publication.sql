-- ============================================================================
-- Migration 0077: Announcements Realtime Publication
--
-- Phase 4 fix: migration 0053 added 10 tables to the supabase_realtime
-- publication; `announcements` (created later, migration 0055) was never
-- added to any of them -- confirmed by grepping every migration for
-- "supabase_realtime", only 0053 touches it. Admin announcements had no
-- realtime delivery path of any kind. RLS on `announcements` already
-- correctly scopes reads to published+non-expired rows for anon and
-- authenticated (migration 0055) -- adding it to the publication does not
-- change or bypass that, exactly as migration 0053's own comment already
-- established for every other table.
-- ============================================================================

alter publication supabase_realtime add table announcements;
