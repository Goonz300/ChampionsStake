# Payment Architecture

## 1. Provider Abstraction

`_payment/types.ts`'s `PaymentProvider` interface is genuinely provider-agnostic: `initializeTransaction`, `verifyTransaction`, `verifyWebhookSignature`, `createTransferRecipient`, `initiateTransfer`, `getTransferStatus`, `initiateRefund`, `lookupTransaction` — none of these shapes are Paystack-specific. `_payment/providers/paystack.ts` is the sole file translating to/from Paystack's actual REST API.

## 2. Providers Actually Implemented

**Paystack only**, confirmed by repo-wide grep for "Stripe"/"Flutterwave"/"Coinbase" before this phase — every match was either a comment describing Stripe as a *removed* leftover from an earlier architecture doc, or a *future* extension point in `registry.ts`'s own comments. No second provider exists, and Phase 6 did not add one (not a proven gap — the brief's Payment Audit named several providers to check for, and the audit confirmed their absence rather than assuming it).

## 3. Failover

`getActiveProvider()` (`registry.ts`) always resolves to Paystack (the sole `DEFAULT_PROVIDER`), gated by a `real_money_enabled` feature flag — not a provider-selection mechanism. There is no fallback if a Paystack call fails; the error propagates. Genuine multi-provider failover was not built in Phase 6 — it would require a second real provider integration first, which is out of this phase's audited-gap scope (no second provider exists to fail over *to*).

## 4. Webhook Security (Unchanged, Verified Sound)

- HMAC-SHA512 over the **raw** request body (never re-parsed/re-serialized JSON, which would break byte-exact signature verification), compared with `timingSafeEqual` (constant-time).
- `payment-webhook/index.ts` deliberately doesn't use the shared `withEdgeFunction` framework (no user JWT exists on a webhook call) — it reads `req.text()` directly.
- Duplicate delivery: `processed_payment_webhook_events`' unique `(provider, provider_event_id)` constraint is the actual enforcement (DB-level, not a pre-check race) — a duplicate INSERT hits Postgres error `23505`, handled gracefully as `{status: "duplicate"}`.
- Deposits/withdrawals are never finalized on the webhook payload's claimed status alone — `verifyAndCompleteDeposit`/`finalizeWithdrawal` re-verify against Paystack's own live API first.

## 5. Idempotency

See [LEDGER_ARCHITECTURE.md](LEDGER_ARCHITECTURE.md) §6 for the three coexisting idempotency mechanisms across the payment/wallet surface.

## 6. Currency

Payment provider calls use `NGN`; the wallet ledger is labeled `USD`. See [WALLET_ARCHITECTURE.md](WALLET_ARCHITECTURE.md) §6 — a pre-existing, symmetric, deliberate simplification, not touched by Phase 6.
