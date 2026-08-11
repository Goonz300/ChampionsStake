# ChampionsStake — Deployment Guide (v1.0)

## Prerequisites
- A Supabase project (Postgres, Auth, Storage, Realtime, Edge Functions, pg_cron, pg_net, Vault all enabled)
- A Vercel account (or any Next.js 15-compatible host)
- Paystack account with test-mode keys (live keys before accepting real money)
- Node.js >= 22.12.0

## 1. Database
```
supabase link --project-ref <your-project-ref>
supabase db push          # applies all 64 migrations in order
```
Seed the required Vault secrets referenced by pg_cron jobs across several phases:
```sql
select vault.create_secret('<value>', 'scheduled_job_shared_secret');
select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/challenge-expire', 'challenge_expire_url');
select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/challenge-archive', 'challenge_archive_url');
select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/tournament-archive', 'tournament_archive_url');
select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/notification-send', 'notification_send_url');
select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/ai-trust-score', 'ai_trust_score_url');
select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/payment-reconciliation', 'payment_reconciliation_url');
```

## 2. Edge Functions
```
supabase functions deploy --project-ref <your-project-ref>
supabase secrets set PAYSTACK_SECRET_KEY=sk_test_xxx --project-ref <your-project-ref>
```

## 3. Next.js app (Vercel)
This is now a monorepo (see `docs/ARCHITECTURE_MONOREPO.md`) — Vercel needs to be told where the app actually lives:
1. Import the repo into Vercel.
2. In Project Settings → General → **Root Directory**, set it to `apps/web`.
3. Vercel auto-detects Next.js and npm workspaces from there; no custom build command override is needed (`npm run build` inside `apps/web` is `next build`).
4. Set the environment variables from `docs/ENV_REFERENCE.md` (Next.js side only — Edge Function secrets are separate, see below).
5. Deploy.

`.env.example` lives at `apps/web/.env.example`.

## 4. Paystack
Set the webhook URL in the Paystack Dashboard to:
`https://<project-ref>.supabase.co/functions/v1/payment-webhook`
Switch `PAYSTACK_SECRET_KEY` to a live key only after test-mode verification and legal/compliance sign-off (see PROD-001-deliverable.md §5 — no Privacy Policy/Terms exist yet; this is a launch blocker, not a code issue).

## 5. Post-deploy verification
- `GET /api/health` and the `health` Edge Function should both return 200.
- Run `supabase/tests/security_tests.sql` against the live database.
- Confirm all 16 `.test.ts` files pass under a real Deno/Vitest runtime (never executed in the AI sandbox that built this project — see Verification Report).
