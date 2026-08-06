-- ============================================================================
-- Migration 0075: Presence Tournament Support + Stale-Presence Sweep Schedule
--
-- Phase 4 (Realtime Platform completion), two independent-review findings
-- from the same audit, grouped here since both extend REALTIME-001's
-- user_presence feature:
--
-- 1. user_presence (migration 0051) tracks current_challenge_id only --
--    there is no tournament-scoped presence at all, despite the brief
--    naming it explicitly. Adds current_tournament_id, mirroring
--    current_challenge_id's own nullable/ON DELETE SET NULL/RLS pattern
--    exactly.
--
-- 2. _realtime/presence.ts's sweepStalePresence() has been fully
--    implemented since REALTIME-001 but was never actually scheduled --
--    migration 0054's own header comment claims "stale-presence sweep...
--    ARE scheduled here," but its actual SQL body only schedules
--    notification-dispatch-every-minute. This migration does not edit
--    0054 (never modify a previous migration) -- it adds the missing
--    cron.schedule call here instead, calling the new presence-sweep
--    Edge Function this phase adds.
-- ============================================================================

alter table user_presence add column current_tournament_id uuid references tournaments (id) on delete set null;
comment on column user_presence.current_tournament_id is
  'Mirrors current_challenge_id (0051) for tournament context -- which tournament the user is currently active in, if any. Null when not in a tournament. Written by the same presence-update Edge Function, never client-trusted beyond the caller''s own JWT identity.';

create policy user_presence_select_tournament_participant on user_presence
  for select
  using (
    current_tournament_id is not null
    and exists (
      select 1 from tournament_registrations
      where tournament_id = user_presence.current_tournament_id
        and user_id = auth.uid()
    )
  );

select cron.schedule(
  'presence-sweep-every-minute',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'presence_sweep_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'scheduled_job_shared_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Set the new Vault secret once per environment (reuses the SAME
-- scheduled_job_shared_secret migration 0054 already created):
--   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/presence-sweep', 'presence_sweep_url');
