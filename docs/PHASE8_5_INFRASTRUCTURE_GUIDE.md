# Phase 8.5 — Infrastructure Guide

The full manual configuration surface, documented exhaustively because no infrastructure-as-code exists to make it self-describing (see `docs/PHASE8_5_INFRASTRUCTURE_AUDIT.md` for why that's a deliberate, proportionate decision for this phase, not an oversight).

## Deployment targets

- **Frontend**: Vercel (inferred from `.github/workflows/ci.yml`'s placeholder env var shape and `docs/DEPLOYMENT_GUIDE.md`'s framing — confirm this is still accurate for the actual deployment before relying on it).
- **Backend**: Supabase-hosted (Postgres, Auth, Realtime, Storage, Edge Functions).

## CI/CD

`.github/workflows/ci.yml` — two jobs, `web` (Node 20.11.0, npm workspace) and `edge-functions` (Deno v2.x). As of this phase, both jobs run their full validation pipeline including tests (`npm run test`/`deno test`) — previously only format/lint/typecheck/build ran, so a regression in tested logic (including the wallet-ledger tests) never blocked a merge before this phase's fix. Deno dependency caching added this phase, keyed on `deno.lock`.

## Runtime versions

- Node: `>=20.11.0`, pinned via `.nvmrc` (added this phase — nothing enforced this locally before).
- Deno: `v2.x`.
- TypeScript: `5.7.2`, exact-pinned.

## Environment variables (full reference)

Backend (`supabase/functions/_shared/config/index.ts`):
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — Supabase project access
- `DATABASE_URL` — direct Postgres connection (for `withTransaction`'s genuine multi-statement transactions)
- `UPSTASH_REDIS_URL`, `UPSTASH_REDIS_TOKEN` — optional, rate-limit backend (Postgres fallback if unset)
- `PAYSTACK_SECRET_KEY`, `PAYSTACK_WEBHOOK_SECRET` — payment provider
- `RESEND_API_KEY` — email delivery
- `EXPO_ACCESS_TOKEN` — optional, push notification delivery
- `SCHEDULED_JOB_SHARED_SECRET` — authenticates `pg_cron`-triggered Edge Function calls

Frontend (`apps/web/lib/env.ts`):
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_APP_URL` — client-safe
- `SUPABASE_SERVICE_ROLE_KEY` — server-only, used sparingly (see `lib/supabase/server.ts`'s `createServiceRoleClient`, justified per call site)
- `RESEND_API_KEY`
- `CAPTCHA_SECRET_KEY` — optional, Turnstile
- `SENTRY_DSN` — declared, not yet consumed (see `PHASE8_5_OBSERVABILITY_GUIDE.md`)

## Cron jobs (`pg_cron`, all follow the same `pg_net.http_post` + Vault-secret pattern since migration `0061`)

| Job | Cadence |
|---|---|
| `ai-ip-intelligence` | every 6h |
| `ai-reputation-engine` | every 30min |
| `ai-moderation-assistant` | every 15min |
| `season-rollover` | hourly |
| `ranking-engine` | every 10min |
| `tournament-scheduling-sweep` | every 5min |
| `wallet-reconciliation` | daily, 03:00 UTC |
| (plus every Phase 1-6 scheduler — see `docs/OPERATIONAL_RUNBOOK.md`) | |

## Storage buckets

See `apps/web/lib/storage/config.ts` (the single TypeScript source of truth, kept in sync with `supabase/migrations/0030`/`0031`'s SQL bucket definitions by convention, not automation — a real drift risk if one is changed without the other). `system-assets` had `image/svg+xml` removed from its allowlist this phase (`docs/PHASE8_5_SECURITY_REVIEW.md`) — both the app-level config and the Storage-level `allowed_mime_types` (migration `0107`) were updated together; keep them together in any future bucket-config change too.

## Recommendation, not built this phase

Infrastructure-as-code (Terraform or Supabase's own declarative config where available) to codify everything on this page instead of relying on it staying accurate by discipline — judged out of proportion for a hardening pass, genuinely large. This document is the reviewable substitute until that's built.
