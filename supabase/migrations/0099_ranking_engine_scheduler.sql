-- ============================================================================
-- Migration 0099: Ranking Engine Scheduler (Phase 8 TOURNAMENT-006)
-- Mirrors the exact pg_cron + pg_net + Vault pattern from migration 0061.
-- ============================================================================

select cron.schedule(
  'ranking-engine-every-10-minutes',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'ranking_engine_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'scheduled_job_shared_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Set the new Vault secret once per environment:
--   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/ranking-engine', 'ranking_engine_url');
