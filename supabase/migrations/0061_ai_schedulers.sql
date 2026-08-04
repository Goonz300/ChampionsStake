-- ============================================================================
-- Migration 0061: AI Platform Schedulers
-- Mirrors the exact pg_cron + pg_net + Vault pattern from every prior
-- phase's schedulers.
-- ============================================================================

select cron.schedule(
  'ai-trust-score-every-10-minutes',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'ai_trust_score_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'scheduled_job_shared_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

select cron.schedule(
  'ai-fraud-scan-hourly',
  '0 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'ai_fraud_scan_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'scheduled_job_shared_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Set the two new Vault secrets once per environment:
--   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/ai-trust-score', 'ai_trust_score_url');
--   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/ai-fraud-scan', 'ai_fraud_scan_url');
