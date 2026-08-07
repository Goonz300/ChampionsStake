# Operational Runbook — Phase 5

## 1. Deployment Checklist

Before deploying this phase to a real environment:

- [ ] Set `UPSTASH_REDIS_URL` / `UPSTASH_REDIS_TOKEN` (Next.js `serverEnv` and Edge Function secrets, via `supabase secrets set`). Without these, every Edge Function rate limit falls back to the Postgres backend — functionally correct but slower and with the `domain_events` growth issue below.
- [ ] Set `EDGE_TRUSTED_PROXY_HOPS` (Edge Functions) and `TRUSTED_PROXY_HOPS` (Next.js) to match the **actual** number of trusted reverse-proxy hops in front of the deployment (1 for a single Cloudflare hop in front of Vercel/Supabase, the common case). Getting this wrong silently mis-attributes IPs for every IP-keyed control (rate limits, lockout, device farming detection). See the Configuration Guide.
- [ ] Set `CAPTCHA_SECRET_KEY` (and provision a Cloudflare Turnstile site) if CAPTCHA protection is desired. Leaving it unset is valid — CAPTCHA simply never triggers.
- [ ] Confirm Cloudflare (or equivalent) is actually in front of the deployment before relying on `CF-Connecting-IP`/`CF-IPCountry` — if it isn't, those headers are absent and the code correctly falls back to `X-Forwarded-For`/no country data, but Layer 1's assumption doesn't hold and IP-based controls are weaker.
- [ ] Run migrations `0079` and `0080` (`login_lockouts`, `device_ip_history`, `devices.last_ip_address`/`country_code`, `fraud_flags`' new `velocity_abuse` enum value).

## 2. Known Operational Gaps

### `domain_events` unbounded growth (Postgres rate-limit fallback)

`PostgresFallbackBackend.increment` (`_shared/security/rate-limit.ts`) inserts a `RateLimitProbe` row into `domain_events` on **every single request** when Upstash isn't configured. No sweep/TTL job exists for these rows. In a Redis-configured deployment this table growth doesn't happen at all (Upstash is used instead); in a Redis-less deployment, this table will grow proportionally to total request volume indefinitely.

**Mitigation until a dedicated sweep job exists**: either configure Upstash (recommended — the fallback path is meant for local development, per the module's own comment), or add a periodic `DELETE FROM domain_events WHERE event_type = 'RateLimitProbe' AND created_at < now() - interval '1 hour'` to an existing scheduled function (e.g. `storage-cleanup`) as a follow-up. Not added speculatively in this phase since no environment in this session's testing actually exercises the fallback path at volume.

### `login_lockouts` has no automatic row cleanup

Expired locks (`locked_until` in the past) are left in the table indefinitely — they're simply not treated as "locked" (`isAccountLocked` checks `locked_until > now()` at read time). This is bounded by actual lockout events (not per-request like the point above), so growth is slow, but a periodic cleanup of rows older than, say, 30 days would be reasonable hygiene. Not added in this phase (no concrete volume problem observed).

### Turnstile outage handling

`verifyCaptcha` fails open (returns `true`) if the `fetch` to Turnstile's siteverify endpoint throws. This means a Cloudflare Turnstile outage silently disables CAPTCHA protection rather than blocking logins. This is the deliberate tradeoff (availability over an additional layer of defense-in-depth) — monitor Turnstile's own status page if CAPTCHA is a load-bearing control for a specific incident response.

## 3. Monitoring

`GET /api/admin/security?view=abuse_stats&hours=24` (admin only) returns:

```json
{
  "window_hours": 24,
  "failed_logins": 0,
  "failed_mfa_verifications": 0,
  "accounts_locked": 0,
  "auth_action_rate_limited_attempts": 0,
  "open_fraud_flags": 0
}
```

There is no push-based alerting on these numbers (e.g. no Slack/PagerDuty integration) — this is a pull endpoint. Wiring it into existing observability (if any is added in a future phase) is out of scope here; it was built to be consumable by that future work, not to replace it.

## 4. Rolling Back This Phase

Every migration has a paired `.down.sql` in `supabase/rollback/`:
- `0079_login_lockouts_table.down.sql`
- `0080_device_signals_and_velocity_fraud_type.down.sql` (note: the new `velocity_abuse` enum value on `fraud_flag_type` **cannot** be dropped by PostgreSQL once added — see that file's own comment)

Code-level rollback is a standard `git revert`/branch rollback — no other stateful side effects (no external service was ever provisioned by this phase; Upstash/Turnstile are opt-in via env vars that, if unset, simply keep the pre-Phase-5 fallback behavior).

## 5. Load-Testing Recommendations (Not Performed in This Phase)

This sandbox has no live Supabase project, Redis instance, or Cloudflare deployment — every claim in this document about behavior under real load is inferred from code review, not measured. Before production rollout, verify:

- Upstash REST API latency under the platform's actual peak request rate (each rate-limit check is 1–2 HTTP round trips to Upstash).
- Postgres fallback behavior under load if Upstash is ever unreachable mid-traffic (the fallback's own INSERT-then-COUNT pattern is two queries per check).
- The realtime broadcast authorization migration (`0078`, prior phase) and this phase's changes together, end-to-end, against a real Supabase project — neither could be exercised against live Realtime/Postgres in this sandboxed environment.
