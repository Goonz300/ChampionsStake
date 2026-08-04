-- ============================================================================
-- Migration 0054: Realtime Platform Schedulers
-- Notification dispatch and stale-presence sweep both tolerate 1-minute
-- granularity (unlike the sub-minute per-entity timers CHALLENGE-001/
-- TOURNAMENT-001 documented as poor fits for pg_cron), so both ARE
-- scheduled here, using the same pattern as every prior phase's schedulers.
-- ============================================================================

select cron.schedule(
  'notification-dispatch-every-minute',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'notification_send_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'scheduled_job_shared_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Set the new Vault secret once per environment:
--   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/notification-send', 'notification_send_url');
