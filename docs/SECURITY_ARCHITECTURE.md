# Security Architecture — Phase 5 (Enterprise Rate Limiting & Attack Mitigation)

Status: as-built, verified against the actual repository at the end of this phase — not aspirational. Every claim below cites a real file. Where something is intentionally not implemented, that is stated explicitly rather than implied.

## 1. Scope

Phase 5 hardens ChampionsStake against automated abuse, credential attacks, and account/payment fraud without redesigning authentication, authorization, RBAC, or the Phase 3/4 middleware pipeline. It extends the multi-layer defense architecture that already existed in fragments (login rate limiting, Edge Function rate limiting, webhook HMAC verification, fraud flags) into a coherent, non-duplicative whole.

## 2. Layer Summary

| # | Layer | Status | Where |
|---|---|---|---|
| 1 | Edge Protection (Cloudflare assumption) | Documented assumption; `CF-Connecting-IP`/`CF-IPCountry` consumed where present | `_shared/security/client-ip.ts`, `lib/security/client-ip.ts` |
| 2 | Global API Rate Limiter | Every `withEdgeFunction` route now gets a default limit even with no explicit config | `_shared/middleware/compose.ts` |
| 3 | Endpoint-Specific Limits | Tuned per-endpoint limits on every admin/moderator/financial/gaming endpoint that lacked one; every web-app auth route now limited | `supabase/functions/*/index.ts`, `apps/web/app/api/auth/*/route.ts` |
| 4 | User/IP/Device Limits | Rate limit keys use user id when authenticated, else trusted-proxy-aware IP | `compose.ts`, `client-ip.ts` |
| 5 | Device Fingerprinting | Expanded with `last_ip_address`, `country_code`, `device_ip_history` | migration `0080`, `lib/auth/device.ts` |
| 6 | Velocity Detection | Withdrawal/challenge-creation/tournament-registration/mass-registration signals, flag-only | `_shared/security/velocity.ts`, `lib/security/device-farming.ts` |
| 7 | Progressive Delays | Configurable step function ahead of login/MFA hard limits | `lib/security/progressive-delay.ts` |
| 8 | Account Lockout | `login_lockouts` table, escalating duration, admin unlock | migration `0079`, `lib/auth/lockout.ts` |
| 9 | CAPTCHA | Turnstile wired for real, triggered only after N failures, never required by default | `lib/security/captcha.ts` |
| 10 | Webhook Security | Paystack HMAC (pre-existing, constant-time) + new rate limit on `payment-webhook` | `_payment/providers/paystack.ts`, `payment-webhook/index.ts` |
| 11 | Database Protection | Idempotency/uniqueness reconciled, not duplicated (see Rate Limiting Architecture §DB) | — |
| 12 | Distributed Rate Limiting | Upstash Redis (fixed window) preferred, Postgres fallback | `_shared/security/rate-limit.ts` |
| 13 | Security Monitoring | Every block/lock writes `audit_logs`; abuse stats surfaced to admins | `_admin/security.ts` |
| 14 | Fraud Events | `fraud_flags` (pre-existing) extended with velocity + mass-registration signals | `velocity.ts`, `device-farming.ts` |
| 15 | Middleware Integration | `fraudCheck` hook added to `withEdgeFunction`; ordering rationale documented | `compose.ts` |
| 16 | Administration | `admin-security` Edge Function + `/api/admin/security` proxy | `admin-security/index.ts` |
| 17 | Configuration | All new thresholds are env-driven, defaulted, never hard-coded | `_shared/config/index.ts`, `lib/env.ts` |
| 18 | Testing | Unit tests for every new pure/DB-mocked module (see below) | `*.test.ts` |
| 19 | Documentation | This document and its seven companions | `docs/` |

## 3. What Changed vs What Was Extended

This phase's own success criterion was "no duplicate rate limiting logic." Concretely:

- **Client IP extraction** was duplicated (and subtly wrong — trusted the spoofable first `X-Forwarded-For` entry) in two places. Consolidated into one implementation per runtime (Deno and Node can't share a module), both trusting `CF-Connecting-IP` first and the *trusted-hop* `X-Forwarded-For` entry otherwise.
- **Edge Function rate limiting** (`enforceRateLimit`) already existed with a Redis/Postgres dual backend. This phase did not replace it — it closed the gap where ~35 of 66 Edge Functions had no rate limit at all, by adding a default fallback plus tuned per-endpoint overrides.
- **`fraud_flags`** already existed (migration `0060`, AI-001) with two unused enum values (`suspicious_withdrawal`, `suspicious_deposit`). This phase wired those up for the first time instead of inventing parallel types, and added exactly one new type (`velocity_abuse`) for signals that didn't already have one.
- **Web-app login/MFA rate limiting** (Postgres/`audit_logs`-backed, deliberately simpler than the Edge Function limiter per its own long-standing documentation) was extended, not replaced: the same `audit_logs` query shape now backs lockout, progressive delay, and the new generic auth-action limiter.

## 4. Known, Honest Gaps

These are not implemented, and this document says so rather than implying otherwise:

- **ASN and timezone device signals**: no live GeoIP/ASN provider or client-side timezone capture exists in this codebase. Only `country_code` (from `CF-IPCountry`, free when behind Cloudflare) was added. Adding unpopulated columns for signals nothing writes would be dead schema.
- **hCaptcha / reCAPTCHA Enterprise**: architecture-ready via the same `shouldRequireCaptcha`/`verifyCaptcha` shape; only Turnstile has a live `fetch` call.
- **Device-validation as a distinct middleware pipeline stage**: no Edge Function client currently sends a device-identity header, so a literal "Device Validation" stage would be inert. Device signals are captured at the Next.js login/register boundary instead (where the device fingerprint is actually derived).
- **Sliding-window / token-bucket algorithms**: `enforceRateLimit` is a fixed-window counter (its own header comment previously overstated "sliding-window" — noted, not silently left). Genuinely swapping algorithms per endpoint was judged out of scope for this phase; see Rate Limiting Architecture §Algorithm Choice for the reasoning.

## 5. Middleware Pipeline (Edge Functions)

Actual order in `withEdgeFunction` (see `compose.ts`), compared against the mandated order:

```
Mandated:  Auth → Session → JWT → Device validation → Rate limit → Fraud scoring → Authorization → Business logic
As-built:  Auth+JWT (one step) → Session → Rate limit → Business logic (Authorization ad-hoc inside) → Fraud scoring (post)
```

Fraud scoring runs **after** business logic, by design: this codebase's fraud signals have been flag-only since AI-001 ("never auto-block funds without human review in v1"). A pre-business-logic fraud stage could only block (contradicting that rule) or score not-yet-committed state (nothing to count). See `compose.ts`'s `fraudCheck` doc comment for the full reasoning.

Authorization is not a distinct pipeline stage — it is called explicitly inside each handler (`requireModerator`, `requireAdministrator`, etc.), as it was before this phase. Promoting it to a generic stage would be an authorization-system redesign, explicitly out of scope.

## 6. Related Documents

- [RATE_LIMITING_ARCHITECTURE.md](RATE_LIMITING_ARCHITECTURE.md)
- [THREAT_MODEL.md](THREAT_MODEL.md)
- [ATTACK_MATRIX.md](ATTACK_MATRIX.md)
- [ABUSE_PREVENTION_GUIDE.md](ABUSE_PREVENTION_GUIDE.md)
- [OPERATIONAL_RUNBOOK.md](OPERATIONAL_RUNBOOK.md)
- [INCIDENT_RESPONSE_GUIDE.md](INCIDENT_RESPONSE_GUIDE.md)
- [CONFIGURATION_GUIDE.md](CONFIGURATION_GUIDE.md)
