-- ============================================================================
-- Migration 0033: Storage Cleanup Schedule
--
-- Schedules the storage-cleanup Edge Function (supabase/functions/
-- storage-cleanup/index.ts) to run every 6 hours via pg_cron + pg_net. The
-- actual blob deletion logic lives in the Edge Function, not here — see that
-- file's header comment for why a bare SQL job cannot safely do this itself.
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- The Edge Function URL and shared secret are read from Vault secrets rather
-- than hard-coded, since they differ between local/staging/production and
-- must not be committed as plain text. Set them once per environment via:
--   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/storage-cleanup', 'storage_cleanup_url');
--   select vault.create_secret('<a-random-secret>', 'storage_cleanup_shared_secret');
-- (and set STORAGE_CLEANUP_SHARED_SECRET to the same value in the Edge
-- Function's environment variables via the Supabase dashboard/CLI).

select cron.schedule(
  'storage-cleanup-every-6-hours',
  '0 */6 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'storage_cleanup_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'storage_cleanup_shared_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
