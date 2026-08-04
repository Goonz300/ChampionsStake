-- ============================================================================
-- Migration 0045: Challenge Lifecycle Schedulers
-- Mirrors the exact pg_cron + pg_net + Vault pattern from STORE-001
-- (migration 0033) and WALLET-001 (migration 0039): a shared secret in
-- Vault, a scheduled net.http_post to each Edge Function's URL.
-- ============================================================================

select cron.schedule(
  'challenge-expire-every-5-minutes',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'challenge_expire_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'scheduled_job_shared_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

select cron.schedule(
  'challenge-archive-daily',
  '0 4 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'challenge_archive_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'scheduled_job_shared_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- NOTE: challenge-start (countdown -> live) and ready-check-timeout are
-- intentionally NOT scheduled here on a fixed pg_cron interval. Both are
-- short (10 minutes or less) per-challenge windows — polling every
-- challenge on a fixed schedule to find the tiny subset whose countdown
-- just elapsed is a poor fit for pg_cron's minimum 1-minute granularity.
-- The correct mechanism is a per-challenge one-shot timer (e.g. a
-- `pg_cron` job scheduled dynamically per challenge at ready-check time,
-- or a Supabase Realtime-driven client nudge that calls challenge-start,
-- which is safe to call early since it re-validates the elapsed time
-- server-side regardless of who calls it). Left as a documented design
-- decision for the phase that builds the notification/scheduling
-- infrastructure precise enough for sub-minute timers, rather than forcing
-- a poor-fit pg_cron job into existence now.
--
-- Set the two new Vault secrets once per environment (reusing
-- 'scheduled_job_shared_secret' from WALLET-001/STORE-001):
--   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/challenge-expire', 'challenge_expire_url');
--   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/challenge-archive', 'challenge_archive_url');
