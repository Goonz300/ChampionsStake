# Phase 8.5 — Deployment Guide

Extends `docs/PHASE7_8_DEPLOYMENT_GUIDE.md` (Phase 7/8-scoped) to cover this whole system's first real production deploy — the first time any of this code will run against a live instance, since none exists in this development environment.

## Pre-deploy: this is genuinely the first live run

Everything in Phases 1-8.5 was built, reviewed, and tested (deno test / vitest) without ever running against a real Supabase project. Treat the first staging deploy as a shakedown of the deployment process itself, not just the application — budget time for it, don't schedule it as a formality immediately before a public launch.

## 1. Provision Supabase

- Create the project (staging first, always).
- Note the project URL, anon key, and service-role key — these become `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
- Enable Point-in-Time Recovery if the plan tier supports it (see `PHASE8_5_DISASTER_RECOVERY_GUIDE.md`) — this is a project setting to confirm, not something this codebase configures.

## 2. Apply every migration, in order

```bash
supabase db push
```

All 107 migrations (`0001` through `0107`) apply in order — every one additive, safe against a fresh project. Confirm:

```bash
supabase migration list
```

## 3. Deploy every Edge Function

```bash
supabase functions deploy
```

(No argument deploys everything under `supabase/functions/`. To deploy a subset during iterative testing, name specific functions — but the full deploy is what a real go-live needs.)

## 4. Register cron jobs — verify, don't just trust the migration ran

Every scheduler (`pg_cron` + `pg_net.http_post` + Vault-stored secret) registers itself via its own migration, but **the Vault secret and target URL inside each migration were authored without a live project to validate against**. After migrating:

```sql
select jobname, schedule, active from cron.job;
```

Cross-check each job's `pg_net.http_post` call actually targets this project's real function URLs (not a placeholder) and that the Vault secret it reads (`select decrypted_secret from vault.decrypted_secrets where name = '...'`) is actually set. A cron job silently failing to fire (or firing against a wrong URL) is not something the application layer can detect — it needs a deliberate check.

Full list: `ai-ip-intelligence` (6h), `ai-reputation-engine` (30min), `ai-moderation-assistant` (15min), `season-rollover` (hourly), `ranking-engine` (10min), `tournament-scheduling-sweep` (5min), `wallet-reconciliation` (daily 03:00 UTC), plus every Phase 1-6 scheduler (`docs/PHASE7_8_MIGRATION_SUMMARY.md`, `docs/OPERATIONAL_RUNBOOK.md`).

## 5. Environment variables (frontend)

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_APP_URL=
SUPABASE_SERVICE_ROLE_KEY=       # server-only
RESEND_API_KEY=
UPSTASH_REDIS_URL=               # optional -- Postgres fallback works without it, but production should have it (see PHASE8_5_SCALING_GUIDE.md)
UPSTASH_REDIS_TOKEN=
CAPTCHA_SECRET_KEY=               # optional -- Turnstile
SENTRY_DSN=                      # declared, not yet consumed -- see PHASE8_5_OBSERVABILITY_GUIDE.md
```

No new env vars beyond what Phase 1-6 already required — every Phase 7/8/8.5 addition reads the same `_shared/config`/`lib/env.ts` pattern.

## 6. Grant the first organizer

Tournament/league creation requires the admin-granted `organizer` role — see `PHASE8_5_OPERATIONS_MANUAL.md`. Nothing works end-to-end until at least one account has it.

## 7. Post-deploy smoke test

Follow `docs/PHASE7_8_DEPLOYMENT_GUIDE.md` §6's checklist (tournament creation → registration → bracket, team creation/invite/ownership-transfer, league/season/reward flow, moderation queue AI-suggestion display) — still accurate and not repeated here.

Additional Phase 8.5-specific checks:
- Confirm the security headers actually appear on a real response (`curl -I` the deployed frontend, check for `Content-Security-Policy`/`X-Frame-Options`/`Strict-Transport-Security`).
- Confirm cookies carry the `Secure` flag in production (`document.cookie` won't show flags; check via browser devtools' Application/Storage panel, or `curl -v` the `Set-Cookie` header).
- Run `PHASE8_5_FINANCIAL_VERIFICATION.md`'s SQL queries against the fresh database (should all return zero rows — a fresh database has no transactions to be wrong about, but this confirms the queries themselves run without error against the real schema).
- Regenerate `apps/web/lib/supabase/types.ts` for real, against the live project (`supabase gen types typescript --project-id <ref> > lib/supabase/types.ts`) — this file has been a documented, hand-extended stopgap since the Frontend milestone specifically because no live project existed to generate it against; this is the first point in the whole project where that's no longer true.

## 8. Load test before declaring launch-ready

`load-tests/` (Step 7) — see `docs/PHASE8_5_LOAD_TESTING.md`. Run against staging, not production, and pair every run with the financial verification queries.

## Rollback

Every migration has a paired `.down.sql` in `supabase/rollback/`, except enum-value-addition migrations (irreversible — Postgres can't drop an enum value, documented in each such migration's own rollback file). Every feature-branch commit this whole project used is an independently-revertable logical unit — `git log --oneline` the branch history before reverting to understand dependency order.
