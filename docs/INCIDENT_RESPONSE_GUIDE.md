# Incident Response Guide — Phase 5

## 1. Suspected Credential Stuffing Attack

**Symptoms**: spike in `failed_logins` (`GET /api/admin/security?view=abuse_stats`), many distinct emails, few distinct IPs (or many IPs if distributed).

**Response**:
1. Check `admin-security?view=locked_accounts` — accounts already self-protected by Layer 8 lockout need no action.
2. If a specific small IP range is responsible and Cloudflare is in front of the deployment, block at the Cloudflare edge (outside this codebase's scope — this phase provides the application-layer signal, not the network-layer block).
3. If the attack is account-specific (one attacker, one target account, rotating IPs — the documented gap in the Threat Model), the per-(email,IP) lockout won't hold them off. Consider a manual, temporary suspension via the pre-existing `admin-users` suspend action (unrelated to this phase, already available) while investigating.
4. Do not disable rate limiting or lockout as a "fix" — that removes the only automated defense currently in place.

## 2. Suspected Mass Account Registration / Farming

**Symptoms**: spike in `AuthActionAttempted` with `action=register`, and/or new `multi_account` fraud flags with `details.signal = "mass_account_creation"`.

**Response**:
1. `GET /api/admin/security?view=fraud_flags&status=open` — filter for `flag_type=multi_account`.
2. Review the flagged accounts' `devices` rows (shared `device_fingerprint`) to confirm genuine farming vs. false positive (e.g. a shared household/NAT IP with a coarse `/24` fingerprint match is a known source of false positives — the fingerprint is UA+Accept-Language+/24-IP, not a hardware ID).
3. Confirmed farms: suspend via the pre-existing `admin-users` action. This phase's own detection is flag-only by design; suspension is a separate, pre-existing admin capability.
4. If false-positive rate is high, raise the threshold (default 5 accounts/device/24h — see `checkDeviceFarming`'s call site in `register/route.ts`, currently hard-coded at the call site, not env-driven — a follow-up could move it to config if false positives are a recurring problem).

## 3. Suspected Withdrawal Fraud

**Symptoms**: `suspicious_withdrawal` fraud flags; abnormal withdrawal velocity for one account.

**Response**:
1. **This is the highest-priority flag type** — it involves real money leaving the platform.
2. `GET /api/admin/security?view=fraud_flags` filtered to `suspicious_withdrawal`, sorted by score (already the default order in `listFraudFlags`).
3. Cross-reference with `admin-wallets?view=transactions&userId=...` (pre-existing) to see the actual transaction history.
4. If confirmed fraudulent and a withdrawal is still `pending` (not yet settled with the payment provider), pre-existing payment admin tooling (`payment-refund`, wallet freeze via `admin-wallets`) applies — this phase does not add new withdrawal-blocking capability, by design (flag-only rule).
5. Mark the flag `reviewed_confirmed` once action is taken, so it stops appearing in the open-flags queue.

## 4. Suspected Webhook Forgery

**Symptoms**: `payment-webhook` receiving requests with invalid `x-paystack-signature`, or unexpected volume against it.

**Response**:
1. HMAC verification (pre-existing, unchanged this phase) already rejects any request without a valid signature — a forged webhook cannot reach `processPaymentWebhook`'s actual logic.
2. This phase added IP-based rate limiting (120 req/60s) to `payment-webhook` — if this limit is being hit by **legitimate** Paystack traffic, that's an operational incident (see Operational Runbook), not a security one. Verify Paystack's actual source IP range before assuming attack.
3. If genuinely under attack (many invalid-signature requests), the rate limit already bounds the resource cost; no further code-level action needed. Consider a Cloudflare-level IP block for sustained abuse (outside this codebase).

## 5. Suspected CAPTCHA Bypass

**Symptoms**: login attempts succeeding past the CAPTCHA-required threshold without a valid `captchaToken`.

**Response**:
1. Check `CAPTCHA_SECRET_KEY` is actually set in the deployment — if unset, CAPTCHA is intentionally never required (this is not a bypass, it's the documented "off" state).
2. Check Turnstile's own status page — `verifyCaptcha` fails open on a verification-request error, so a Turnstile outage looks identical to "bypassed" from the login route's perspective.
3. If Turnstile is healthy and `CAPTCHA_SECRET_KEY` is set but attempts are still succeeding without it, this is a genuine code-level bug — escalate as a P1, since it means the layer meant to slow down credential-stuffing tooling is silently inert.

## 6. Emergency: Disabling a Specific Control

All of these are environment-variable-driven and can be adjusted without a code deploy (see the Configuration Guide) **except** per-endpoint Edge Function rate limits, which are hard-coded per function by design (see the Abuse Prevention Guide §4 for why). If an emergency requires disabling a hard-coded per-endpoint limit, that requires a code change and redeploy — there is deliberately no "kill switch" env var for individual endpoint limits, to avoid a single misconfigured flag silently disabling protection platform-wide.

If the Edge Function rate limiter itself is causing a platform-wide outage (e.g. Upstash and its Postgres fallback are both failing), `enforceRateLimit`'s failure propagates as an uncaught exception through `withEdgeFunction`, which returns a 500 — this fails **closed** (requests are rejected, not silently allowed through). This is the correct default for a security control but means a rate-limiter infrastructure failure becomes a platform outage. There is no fail-open override in this phase; adding one would need to be a deliberate, reviewed decision given the availability-vs-security tradeoff, not an emergency-only toggle.
