-- ============================================================================
-- Migration 0088: IP Intelligence Scheduler (Phase 7 AI-003)
-- Mirrors the exact pg_cron + pg_net + Vault pattern from migration 0061.
-- Every 6 hours, not every 10 minutes like ai-trust-score: TOR exit nodes
-- and cloud provider ranges churn far slower than trust-relevant events.
-- ============================================================================

select cron.schedule(
  'ai-ip-intelligence-every-6-hours',
  '0 */6 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'ai_ip_intelligence_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'scheduled_job_shared_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Set the new Vault secret once per environment:
--   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/ai-ip-intelligence', 'ai_ip_intelligence_url');
