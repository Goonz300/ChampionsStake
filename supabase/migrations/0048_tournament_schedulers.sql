-- ============================================================================
-- Migration 0048: Tournament Schedulers
-- Mirrors the exact pg_cron + pg_net + Vault pattern from every prior
-- phase's schedulers (STORE-001 migration 0033, WALLET-001 migration 0039,
-- CHALLENGE-001 migration 0045).
-- ============================================================================

select cron.schedule(
  'tournament-archive-daily',
  '0 5 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'tournament_archive_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'scheduled_job_shared_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- NOTE: check-in-timeout (tournament-checkin's sweep mode) and
-- round-timeout (tournament-complete-round's sweep mode) are NOT scheduled
-- on a fixed pg_cron interval, for the identical reason CHALLENGE-001's
-- migration 0045 documented for ready-check/countdown timers: both are
-- short, per-tournament windows that a fixed-interval poll across every
-- active tournament is a poor fit for. Deferred to the same future
-- precise-scheduling phase.
--
-- Set the new Vault secret once per environment:
--   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/tournament-archive', 'tournament_archive_url');
