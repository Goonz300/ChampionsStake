-- ============================================================================
-- Migration 0092: AI Moderation Assistant Scheduler (Phase 7 AI-006)
-- Mirrors the exact pg_cron + pg_net + Vault pattern from migration 0061.
-- Every 15 minutes -- open dispute volume is low relative to trust/fraud
-- events, and moderator-dashboard's ai_suggestion view also regenerates
-- on-demand, so this sweep is a background refresh, not the only path.
-- ============================================================================

select cron.schedule(
  'ai-moderation-assistant-every-15-minutes',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'ai_moderation_assistant_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'scheduled_job_shared_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Set the new Vault secret once per environment:
--   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/ai-moderation-assistant', 'ai_moderation_assistant_url');
