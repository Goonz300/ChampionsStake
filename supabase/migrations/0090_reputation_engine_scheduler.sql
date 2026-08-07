-- ============================================================================
-- Migration 0090: Reputation Engine Scheduler (Phase 7 AI-004)
-- Mirrors the exact pg_cron + pg_net + Vault pattern from migration 0061.
-- ============================================================================

select cron.schedule(
  'ai-reputation-engine-every-30-minutes',
  '*/30 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'ai_reputation_engine_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'scheduled_job_shared_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Set the new Vault secret once per environment:
--   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/ai-reputation-engine', 'ai_reputation_engine_url');
