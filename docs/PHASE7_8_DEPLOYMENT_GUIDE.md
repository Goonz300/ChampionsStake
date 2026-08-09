# Phase 7 + 8 Deployment Guide

## Prerequisites

A live Supabase project (staging or production) — this phase was built and validated entirely against no live instance (no Supabase project exists in the sandboxed development environment this session ran in), so first deployment to a real project is also the first time this code runs against a real Postgres/Realtime/Edge Functions backend. Treat the first deploy as a verification step, not a formality.

## 1. Apply migrations, in order

```bash
supabase db push
```

Migrations `0086` through `0105` apply in order after whatever the target project's current migration head is. All are additive — safe to run against a project that already has `0001`-`0085` applied (Phase 1-6). Confirm the migration head afterward:

```bash
supabase migration list
```

If a migration fails partway, the paired `.down.sql` in `supabase/rollback/` for that specific migration (and any applied after it, in reverse order) is the rollback path — **except** any enum-value-addition migration, which cannot be cleanly rolled back (Postgres cannot drop an enum value); see `PHASE7_8_MIGRATION_SUMMARY.md` for which migrations that applies to.

## 2. Deploy Edge Functions

```bash
supabase functions deploy team-manage league-manage ranking-manage ranking-engine \
  season-rollover tournament-organize tournament-scheduling-sweep \
  ai-ip-intelligence ai-reputation-engine ai-moderation-assistant ai-recommendations \
  tournament-create tournament-browse
```

(Also redeploy `moderator-dashboard`, `admin-wallets`, `admin-system-health`, `_ai/trust-score`'s consuming functions, and `_realtime/notifications`'s consuming functions if they weren't already current — several were modified, not just the new ones. Simplest is `supabase functions deploy` with no argument to deploy everything.)

## 3. Register cron jobs

Each scheduler's migration (`0088`, `0090`, `0092`, `0097`, `0099`, `0102`) registers its own `pg_cron` job via `cron.schedule(...)` calling `pg_net.http_post` against the deployed function's URL, authenticated with a secret read from Vault. Confirm after migration:

```sql
select jobname, schedule, active from cron.job where jobname like '%phase7%' or jobname like '%phase8%' or jobname in (
  'ai-ip-intelligence-every-6-hours', 'ai-reputation-engine-every-30-minutes',
  'ai-moderation-assistant-every-15-minutes', 'season-rollover-hourly',
  'ranking-engine-every-10-minutes', 'tournament-scheduling-sweep-every-5-minutes'
);
```

Each job's `pg_net.http_post` call needs the target function's URL and the Vault-stored scheduler secret to actually match the deployed project — this is set inside each migration file, but **verify it against the target project's actual URL**, since a migration authored without a live project has no way to have validated this against a real endpoint.

## 4. Environment variables (frontend)

`apps/web/.env.local` (or the hosting platform's env config) needs real values for:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=   # server-only, never exposed to the client
```

No new env vars were introduced by Phase 7/8 beyond what Phase 1-6 already required — every new Edge Function reads the same `_shared/config` values as existing functions.

## 5. Grant the `organizer` role

Tournament creation and league-manage's mutating actions require `profiles.role = 'organizer'`, admin-granted (not self-service, by design — see `ORGANIZER_PLATFORM_DESIGN.md` §1 and the Critical fixes in `PHASE7_8_SECURITY_REVIEW.md`). Before any real organizer can use the platform, an administrator needs to grant this role, the same way existing `moderator`/`administrator` role grants work (`admin-users`-style update, no new endpoint was built for this specifically since the existing role-management surface already covers it).

## 6. Post-deploy smoke test

1. Grant yourself the `organizer` role.
2. Create a tournament template (`tournament-organize {action:"create_template"}`), spawn a tournament from it, confirm the `Idempotency-Key` header is required (a request without it should 400/422, not succeed).
3. Create a league, division, and season with a small `rewardStructure`; end the season; confirm the reward lands in the test wallet via the normal ledger.
4. Create a team, invite a second test account, accept, transfer ownership; confirm `teams.owner_id` actually changed and the *original* owner can no longer perform owner-only actions.
5. Watch the moderator dashboard's queue (`v_moderator_queue`) for a test dispute; confirm `ai_suggested_priority`/`ai_confidence` columns appear once `ai-moderation-assistant` has run at least once.
6. Confirm the frontend's new pages (`/tournaments`, `/teams`, `/leagues`, `/leaderboards`, `/organizer`) load without a Supabase `.from()` type error — the hand-extended `lib/supabase/types.ts` (see that file's own header comment) should be replaced with real generated types (`supabase gen types typescript`) against this now-live project as an early follow-up, not left as a permanent stopgap.

## 7. Rollback

If a genuine defect is found post-deploy that these review passes missed: the feature branch's individual commits are each a self-contained, independently-validated logical unit (one milestone or one fix category per commit) — reverting a single commit is safe without unwinding the whole phase, as long as no later commit depends on it (check `git log --oneline` for the dependency order before reverting).
