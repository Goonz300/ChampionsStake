-- ============================================================================
-- Migration 0102: Tournament Scheduling Sweep (Phase 8 TOURNAMENT-010)
-- Mirrors the exact pg_cron + pg_net + Vault pattern from migration 0061.
-- Every 5 minutes: registration/check-in windows are the most
-- time-sensitive automatic transition this platform has (a tournament
-- sitting in 'draft' past its own registration_opens_at is a visibly
-- broken tournament to any player watching for it), tighter than the
-- 10-30 minute cadence used elsewhere in this schema.
-- ============================================================================

select cron.schedule(
  'tournament-scheduling-sweep-every-5-minutes',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'tournament_scheduling_sweep_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'scheduled_job_shared_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Set the new Vault secret once per environment:
--   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/tournament-scheduling-sweep', 'tournament_scheduling_sweep_url');
