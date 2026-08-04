-- ============================================================================
-- Migration 0039: Wallet Reconciliation Schedule
-- Daily reconciliation sweep (Business Rules §15: "nightly automated job"),
-- mirroring STORE-001 migration 0033's pg_cron + pg_net + Vault pattern
-- exactly (pg_cron/pg_net already enabled by that migration).
-- ============================================================================

select cron.schedule(
  'wallet-reconciliation-daily',
  '0 3 * * *', -- 03:00 UTC daily, off-peak
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'wallet_reconciliation_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'scheduled_job_shared_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Set the two Vault secrets once per environment:
--   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/wallet-reconciliation', 'wallet_reconciliation_url');
--   select vault.create_secret('<a-random-secret>', 'scheduled_job_shared_secret');
-- (and set EDGE_SCHEDULED_JOB_SHARED_SECRET to the same value in every
-- scheduled Edge Function's environment variables — this secret is now
-- shared across storage-cleanup and wallet-reconciliation, per the generic
-- config key introduced in this phase's _shared/config/index.ts update.)
