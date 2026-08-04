# ChampionsStake — Environment Variable Reference

## Next.js app (`apps/web/.env.local`, see `apps/web/.env.example`)
| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Public Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Public anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-only, never exposed to the client |
| `NEXT_PUBLIC_APP_URL` | Yes | e.g. `https://championsstake.app` |
| `RESEND_API_KEY` | Yes | Transactional email |

## Supabase Edge Function secrets (`supabase secrets set`, NOT read from `apps/web/.env.local`)
| Variable | Required | Notes |
|---|---|---|
| `PAYSTACK_SECRET_KEY` | Yes | Test key for staging, live key for production — never hardcoded, read only in `providers/paystack.ts` |
| `SCHEDULED_JOB_SHARED_SECRET` | Yes | Authenticates pg_cron -> Edge Function calls, stored in Vault |

No other secrets exist in this codebase. `STRIPE_*` variables were removed in PROD-001 -- Paystack is the only implemented payment provider (see `PAYMENT-001-deliverable.md`).
