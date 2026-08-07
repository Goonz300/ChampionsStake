-- ============================================================================
-- Migration 0097: Season Rollover Scheduler (Phase 8 TOURNAMENT-005)
-- Mirrors the exact pg_cron + pg_net + Vault pattern from migration 0061.
-- Hourly: season end dates are day/week-granularity, not minute-granularity.
-- ============================================================================

select cron.schedule(
  'season-rollover-hourly',
  '0 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'season_rollover_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'scheduled_job_shared_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Set the new Vault secret once per environment:
--   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/season-rollover', 'season_rollover_url');
