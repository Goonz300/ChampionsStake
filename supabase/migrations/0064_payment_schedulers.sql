-- ============================================================================
-- Migration 0064: Payment Reconciliation Scheduler
-- Mirrors the exact pg_cron + pg_net + Vault pattern from every prior
-- phase's schedulers.
-- ============================================================================

select cron.schedule(
  'payment-reconciliation-every-15-minutes',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'payment_reconciliation_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'scheduled_job_shared_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Set the new Vault secret once per environment:
--   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/payment-reconciliation', 'payment_reconciliation_url');
--
-- Also required (Edge Function environment variables, set via Supabase
-- CLI/dashboard secrets, NEVER committed):
--   PAYSTACK_SECRET_KEY   (test key for now, per this phase's brief — swap
--                          to a live key for production with zero code
--                          changes, since providers/paystack.ts reads it
--                          from the environment, never hardcoded)
