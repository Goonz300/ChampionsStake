# Threat Model — Phase 5

Scope: attacks against ChampionsStake's authentication, rate-limiting, payment, and fraud-detection surfaces. Excludes application logic bugs unrelated to abuse (covered by ordinary code review) and infrastructure-level threats outside this codebase's control (Cloudflare/Supabase platform compromise, DNS hijacking).

## 1. Actors

| Actor | Motivation | Capability |
|---|---|---|
| Credential stuffer | Account takeover using leaked credential lists | Scripted, high-volume, distributed IPs |
| Account farmer | Multi-account abuse (bonus abuse, tournament seeding manipulation, collusion) | Scripted registration, may reuse devices/IPs |
| Payment fraudster | Extract funds via withdrawal abuse, chargeback, webhook forgery | Knowledge of Paystack's API shape, possibly a compromised legitimate account |
| Griefer / spammer | Chat/challenge/tournament spam, denial of service against other players | Low sophistication, high request volume |
| Curious/malicious insider | Abuse of admin/moderator tooling | Legitimate credentials, elevated trust |

## 2. Assets

- User credentials and MFA secrets
- Wallet balances and the ledger that backs them
- Escrow funds mid-challenge/tournament
- Platform trust signals (trust_score, fraud_flags) — corrupting these degrades every other user's experience
- Admin/moderator action integrity

## 3. Threats and Mitigations

| Threat | Mitigation | Residual Risk |
|---|---|---|
| Credential stuffing against `/api/auth/login` | Progressive delay (Layer 7) + hard rate limit + account lockout (Layer 8) + CAPTCHA after N failures (Layer 9), all keyed by (normalized email, IP) — email is lowercased/trimmed before use specifically because Supabase Auth treats email case-insensitively; found and fixed during this phase's own hostile review (an unnormalized key would have let an attacker bypass every one of these controls by rotating casing on one target email) | A distributed attack (many IPs, one account) still accumulates toward lockout since lockout is per (email, IP) — a distributed attacker spreads across many lockout buckets. **Not fully mitigated**; see §5. |
| Brute-forcing a TOTP code post-password | `isMfaVerifyRateLimited`, fail-**closed** (pre-existing, unchanged) | None significant — 5 attempts/15min against 1,000,000 possibilities |
| Mass account registration (farming) | Rate limit on `/api/auth/register` + device-fingerprint farming detection (flags at 5+ accounts/device/24h) | Fingerprint is UA+Accept-Language+/24-IP — a determined farmer rotating all three defeats it. Flag-only by design (never blocks registration), so even a detected farm isn't stopped automatically. |
| Fake/forged Paystack webhook | HMAC-SHA512 signature, constant-time compare (pre-existing) | None significant if `PAYSTACK_SECRET_KEY` stays secret |
| Webhook replay (same valid signed payload resent) | `processed_payment_webhook_events` unique constraint | None — DB-enforced, not a race |
| Withdrawal spam from a compromised account | `payment-transfer` rate limit (10/min) + one-pending-withdrawal-per-wallet constraint (pre-existing) + withdrawal velocity fraud flag (new) | Flag is post-hoc (moderator review), not a block — a fast attacker could complete several withdrawals before review |
| Chat/challenge/tournament spam | Per-endpoint rate limits (pre-existing + this phase's gap closure) + global default fallback | None significant |
| Admin/moderator tool abuse by a legitimate-but-malicious insider | `requireAdministrator`/`requireModerator` (pre-existing, unchanged) + rate limits on every admin-*/moderator-* function (new) + `AccountUnlocked`/`AccountLocked`/fraud-flag-review audit trail | Rate limiting doesn't prevent a single deliberate malicious action by a genuinely elevated actor — that is an RBAC/audit problem, explicitly out of this phase's scope |
| CAPTCHA-solving farms / OCR bypass | Turnstile (Cloudflare's own bot-detection signal, not a simple image CAPTCHA) | Inherent to any CAPTCHA provider; not eliminable from this layer alone |
| IP spoofing via forged `X-Forwarded-For` | `client-ip.ts` trusts `CF-Connecting-IP` first, else the Nth-from-end `X-Forwarded-For` entry (trusted-hop-count, not the spoofable first entry) | If `EDGE_TRUSTED_PROXY_HOPS`/`TRUSTED_PROXY_HOPS` is misconfigured (wrong hop count) for the actual deployment topology, IP-keyed limits/lockouts key on the wrong address. **Operational risk, not a code gap** — see the Configuration Guide. |
| Rate-limit bypass via Upstash outage | Automatic fallback to Postgres backend | Postgres fallback has no `RateLimitProbe` cleanup — see Operational Runbook |
| Impossible-travel account takeover (login from two geographically distant locations in a short window) | **Not implemented.** `country_code` is captured (from `CF-IPCountry`) but no cross-login distance/velocity check exists yet. | Explicit gap — flagged, not silently omitted. Would need a `country_code` history diff at login time; deferred as a follow-up, not built speculatively without a concrete consumer. |

## 4. Trust Boundaries

```
Internet
  │  (Layer 1: assume Cloudflare — CF-Connecting-IP / CF-IPCountry trusted)
  ▼
Next.js (Vercel) ──────────────┐
  │  service-role DB access     │  Supabase Auth (GoTrue)
  ▼                             ▼
Postgres (RLS-enforced for      Supabase Edge Functions (Deno)
user-scoped queries; service-     │  JWT-verified per request
role bypasses RLS by design,      │  service-role DB access for writes
used only in server-side code)    ▼
                                 Postgres (same instance, same RLS rules)
                                   │
                                   ▼
                                 Upstash Redis (rate-limit counters only —
                                 no application data, so an Upstash
                                 compromise leaks nothing beyond request
                                 volume patterns)
```

Every service-role client bypasses RLS. This is unchanged from before this phase — the phase's own new service-role writes (`lockout.ts`, `device-farming.ts`, `_admin/security.ts`, `velocity.ts`) all run server-side only, never reachable from client code, matching the existing pattern for every other service-role write in this codebase.

## 5. Explicitly Out of Scope

- **Distributed credential stuffing across many IPs against one account**: lockout is per-(email, IP), so an attacker rotating IPs resets the lockout bucket each time. A per-email-only lockout would fix this but reopens account-enumeration risk (an attacker could lock a victim's account by deliberately failing logins from their own single IP, a denial-of-service against the legitimate user) and was judged the worse tradeoff. Documented, not silently accepted.
- **CAPTCHA-solving services** (human click-farms): no technical control fully defeats a paid human solver; Turnstile's behavioral signals raise the cost, they don't eliminate it.
- **Compromised legitimate credentials used exactly as a legitimate user would** (correct password, correct MFA, normal request volume): indistinguishable from real usage by any control in this phase. This is what trust_score/fraud_flags' moderator-review model exists for, and is unchanged by this phase.
