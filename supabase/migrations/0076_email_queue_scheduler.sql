-- ============================================================================
-- Migration 0076: Email Queue Scheduler
--
-- Phase 4: schedules the new email-queue-process Edge Function, the
-- missing consumer for email_queue (migration 0065, schema-only until
-- this phase). Reuses the SAME scheduled_job_shared_secret Vault secret
-- migration 0054 already created -- no new secret-management pattern.
-- ============================================================================

select cron.schedule(
  'email-queue-process-every-minute',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'email_queue_process_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'scheduled_job_shared_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Set the new Vault secret once per environment:
--   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/email-queue-process', 'email_queue_process_url');
