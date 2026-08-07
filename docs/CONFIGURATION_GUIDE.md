# Configuration Guide — Phase 5

All thresholds introduced by this phase are environment-variable-driven with sane defaults — none are hard-coded in a way that would require a code change to tune (per-endpoint Edge Function rate limits are the one deliberate exception; see the Incident Response Guide §6 for why).

## Edge Functions (`supabase/functions/_shared/config/index.ts`)

Set via `supabase secrets set KEY=value`, never read directly with `Deno.env.get()` outside `config/index.ts`.

| Variable | Default | Purpose |
|---|---|---|
| `EDGE_TRUSTED_PROXY_HOPS` | `1` | Reverse-proxy hops trusted between the real client and this function, for `X-Forwarded-For` parsing. **Must match actual deployment topology** — see Operational Runbook. |
| `UPSTASH_REDIS_URL` | unset | Upstash Redis REST endpoint. Unset → Postgres fallback for rate limiting. |
| `UPSTASH_REDIS_TOKEN` | unset | Upstash Redis REST auth token. |
| `EDGE_RATE_LIMIT_WINDOW_SECONDS` | `60` | Global default rate-limit window for any function without a tuned override. |
| `EDGE_RATE_LIMIT_MAX_REQUESTS` | `60` | Global default max requests per window. |
| `CAPTCHA_PROVIDER` | `turnstile` | Provider identifier — only `turnstile` has a live implementation. |
| `CAPTCHA_SECRET_KEY` | unset | Turnstile secret key. Unset → CAPTCHA never triggers (web-app side; this Edge config entry exists for a future Edge-side consumer, none exists yet). |
| `CAPTCHA_TRIGGER_AFTER_FAILURES` | `3` | Recent-failure threshold before CAPTCHA is required. |
| `LOCKOUT_FAILURES_TO_LOCK` | `5` | Failures within the rate-limit window before an account locks. |
| `LOCKOUT_INITIAL_MINUTES` | `15` | First lockout duration. |
| `LOCKOUT_MAX_MINUTES` | `1440` (24h) | Cap on escalating lockout duration (doubles per repeat offense). |
| `PROGRESSIVE_DELAY_STEPS_SECONDS` | `0,2,5,15,30` | Comma-separated delay steps indexed by recent-failure count. |
| `FRAUD_WITHDRAWAL_VELOCITY_WINDOW_SECONDS` | `60` | Withdrawal velocity check window. |
| `FRAUD_WITHDRAWAL_VELOCITY_MAX` | `3` | Withdrawals per window before flagging. |
| `FRAUD_CHALLENGE_VELOCITY_WINDOW_SECONDS` | `60` | Challenge-creation velocity window. |
| `FRAUD_CHALLENGE_VELOCITY_MAX` | `10` | Challenges per window before flagging. |
| `FRAUD_TOURNAMENT_VELOCITY_WINDOW_SECONDS` | `60` | Tournament-registration velocity window. |
| `FRAUD_TOURNAMENT_VELOCITY_MAX` | `5` | Registrations per window before flagging. |
| `FRAUD_FAILED_LOGIN_VELOCITY_WINDOW_SECONDS` | `900` | Reserved — see Attack Matrix's honest note that this isn't wired to a flag-writer yet. |
| `FRAUD_FAILED_LOGIN_VELOCITY_MAX` | `10` | Reserved, same caveat. |
| `FRAUD_PASSWORD_RESET_VELOCITY_WINDOW_SECONDS` | `3600` | Reserved, same caveat. |
| `FRAUD_PASSWORD_RESET_VELOCITY_MAX` | `5` | Reserved, same caveat. |

## Next.js Web App (`apps/web/lib/env.ts`, `serverEnv`)

| Variable | Default | Purpose |
|---|---|---|
| `TRUSTED_PROXY_HOPS` | `1` | Same concept as the Edge Function equivalent, separate variable because the two runtimes read env vars independently (see `client-ip.ts` in both places). |
| `CAPTCHA_PROVIDER` | `turnstile` | Same as Edge. |
| `CAPTCHA_SECRET_KEY` | unset | **This is the one actually consulted by `verifyCaptcha`** (login flow is web-app-side). |
| `CAPTCHA_TRIGGER_AFTER_FAILURES` | `3` | Same as Edge. |
| `LOCKOUT_FAILURES_TO_LOCK` | `5` | Consulted by `lib/auth/lockout.ts`. |
| `LOCKOUT_INITIAL_MINUTES` | `15` | Same. |
| `LOCKOUT_MAX_MINUTES` | `1440` | Same. |
| `PROGRESSIVE_DELAY_STEPS_SECONDS` | `0,2,5,15,30` | Consulted by `lib/security/progressive-delay.ts`. |
| `UPSTASH_REDIS_URL` / `UPSTASH_REDIS_TOKEN` | unset | Pre-existing in `serverEnv`, still unused by the web app's own login/MFA limiter (Postgres-only by design — see Rate Limiting Architecture §1). |

## Pre-Existing, Unchanged by This Phase

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` — required, unchanged.
- `EDGE_ALLOWED_ORIGINS`, `EDGE_REPLAY_WINDOW_SECONDS`, `EDGE_SCHEDULED_JOB_SHARED_SECRET` — pre-existing `security` config, unchanged.
- `PAYSTACK_SECRET_KEY` — Paystack HMAC secret, unchanged.

## A Note on `EDGE_TRUSTED_PROXY_HOPS` / `TRUSTED_PROXY_HOPS`

This is the single most operationally important new variable in this phase. Every IP-keyed control (rate limiting for anonymous/optional-auth endpoints, account lockout, device-farming detection, CAPTCHA triggering) depends on `client-ip.ts` correctly identifying the real client IP. If the deployment topology is:

```
Client → Cloudflare → Vercel/Supabase (1 hop)
```

then `1` (the default) is correct. If there's an additional internal load balancer or proxy that also appends to `X-Forwarded-For`, this must be increased accordingly, or every IP-keyed control will key on the wrong address (typically an internal proxy's IP, which is the same for every request — collapsing every anonymous user into one shared bucket). `CF-Connecting-IP`, when present, bypasses this entirely (Cloudflare sets it directly, not subject to hop-counting) — misconfiguring the hop count only matters for deployments not actually behind Cloudflare, or for the deployments' own internal `X-Forwarded-For` fallback path.
