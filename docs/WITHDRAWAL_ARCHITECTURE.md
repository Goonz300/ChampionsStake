# Withdrawal Architecture

Every control a withdrawal passes through, in order, as of the end of Phase 6.

## 1. Pipeline

```
payment-transfer (Edge Function)
  1. requireVerifiedPlayer          -- KYC-complete (pre-existing)
  2. requireAal2IfMfaEnrolled        -- Phase 6, only if MFA is enrolled
  3. rate limit (10 req/60s)         -- Phase 5
  4. checkVelocity (post-hoc flag)   -- Phase 5, flags fraud_flags, never blocks
  ↓
requestWithdrawal (_payment/withdrawal-service.ts)
  5. WITHDRAWAL_MIN_CENTS check      -- pre-existing
  6. assertWithinWithdrawalLimits    -- Phase 6, daily + monthly caps
  7. payout method ownership check   -- pre-existing
  8. assertNotSanctioned             -- Phase 6, blocklist screening
  9. one-in-flight-withdrawal check  -- pre-existing (now also covers pending_review)
  10. initiateWithdrawalHold         -- pre-existing, funds moved to `pending`
  11. manual-review threshold check  -- Phase 6, branches the flow
  12a. [below threshold] provider.initiateTransfer immediately
  12b. [at/above threshold] held at status='pending_review', provider NOT called
```

## 2. Layer Detail

### MFA/AAL2 Enforcement (Phase 6)

`requireAal2IfMfaEnrolled` (`_shared/permissions/index.ts`) checks the caller's session `aal` claim (decoded from the JWT, `_shared/auth/jwt.ts`'s `decodeJwtAal`) — but only if the account actually has a verified MFA factor (checked via `supabase.auth.mfa.listFactors()` on a client scoped to the caller's own JWT, the *same* call `apps/web`'s login route already uses for the identical check — not a second implementation). Unconditionally requiring aal2 would lock every non-MFA account out of withdrawing entirely, since MFA is opt-in.

**Confirmed gap this closed**: MFA infrastructure has existed since Phase 3C, but every check of it lived entirely in `apps/web`'s own Next.js routes. `payment-transfer` is called directly (not proxied through a Next.js API route), so a stolen aal1-only session token could previously withdraw funds without ever completing MFA, even on an MFA-enrolled account.

### Daily/Monthly Limits (Phase 6)

`assertWithinWithdrawalLimits` sums `payment_intents` (`kind='withdrawal'`, status in `pending`/`pending_review`/`completed` — i.e., still-live commitments; `failed`/`expired` already returned their hold) since the start of the current UTC day/month, and rejects if the new withdrawal would push either total over `WITHDRAWAL_DAILY_LIMIT_CENTS` (default $5,000) / `WITHDRAWAL_MONTHLY_LIMIT_CENTS` (default $50,000).

### Sanctions/PEP Screening (Phase 6)

See [FRAUD_INTEGRATION.md](FRAUD_INTEGRATION.md) §3.

### Manual Review (Phase 6)

At or above `WITHDRAWAL_MANUAL_REVIEW_THRESHOLD_CENTS` (default $2,000), funds are placed on hold (protecting against double-withdrawal) but the payment provider is never called until an administrator explicitly approves via `admin-wallets`' `approve_withdrawal`/`reject_withdrawal` actions. See [SETTLEMENT_FLOW.md](SETTLEMENT_FLOW.md) for the full approve/reject flow.

## 3. What Was Already There (Unchanged)

- KYC enforcement (`requireVerifiedPlayer`, at the Edge Function boundary).
- Velocity-based fraud flagging (`checkVelocity`, Phase 5) — informational, doesn't block.
- Rate limiting (Phase 5).
- The hold-then-settle two-phase design (`initiateWithdrawalHold` → `settleWithdrawal`/`reverseWithdrawalHold`), which pre-dates Phase 6 and every new control in this phase builds on top of rather than replaces.

## 4. Explicitly Not Built

- **Real-time sanctions API integration** — no live provider is reachable from this environment; the blocklist is a genuine, functional substitute using the only data source actually available (admin-entered names), not a stub. See [FRAUD_INTEGRATION.md](FRAUD_INTEGRATION.md).
- **Automatic scheduler-driven withdrawal auto-approval below a lower "trusted user" threshold** — not requested, not built; every below-manual-review-threshold withdrawal already auto-processes, so this would only matter if a *third* tier were desired.
