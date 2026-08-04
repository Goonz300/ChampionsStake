# PAYMENT-001 — Enterprise Payment Gateway Framework (Paystack First Provider)

## 1. Payment Architecture

`Frontend -> Payment API -> PaymentProvider interface -> Provider Registry -> Paystack -> Wallet Engine -> Escrow Engine`, exactly as the brief's diagram specifies. The load-bearing guarantee: **the Payment Layer never writes `wallet_ledger`/`wallet_transactions` itself** — verified by grep, not just asserted. Every credit/debit goes through 4 new functions added to WALLET-001's own `_wallet/transfer.ts` (`completeDeposit`, `initiateWithdrawalHold`, `settleWithdrawal`, `reverseWithdrawalHold`), which themselves call `postBalancedEntries` — the same single write-path every prior financial phase has used.

## 2. Two real bugs caught and fixed before they ever ran

**Bug 1 (deposits)**: the natural first draft pre-created a `wallet_transactions` row at deposit-initialize time, then called `completeDeposit()` on verification — but `completeDeposit()` goes through `postBalancedEntries()`, which *always* inserts its own fresh row (WALLET-001's correct, unmodified design). That would have left two transaction rows per real deposit.

**Bug 2 (withdrawals)**: `postBalancedEntries()` always marks a transaction `completed` immediately — a first draft tried to later `UPDATE` that same row's status to `processing` while waiting on the provider transfer, which DB-001's own immutability trigger would reject outright against a real database.

Both share one root cause: conflating the ledger's record of money that has genuinely moved (always immediately final, by WALLET-001's design) with the payment layer's record of an in-flight provider interaction (explicitly mutable while pending). Fixed with one generic table, `payment_intents` (a `kind` discriminator covers both deposit and withdrawal), so both services share one bookkeeping mechanism without touching the ledger's own tables before there's real money to record. Migration 0063's header documents both bugs in full, not just the fix.

## 3. Folder Structure

```
supabase/functions/_payment/
  types.ts               PaymentProvider interface -- the pluggability contract
  registry.ts             provider factory, reads real_money_enabled feature flag
  providers/paystack.ts    Provider #1 -- the only file that knows Paystack's actual API shapes
  deposit-service.ts       initialize + verify-and-complete (backend-verification-only)
  withdrawal-service.ts    payout methods, hold/settle/reverse orchestration
  webhook-service.ts       signature verification + idempotency + dispatch
  refund-service.ts        architecture only, per explicit scope (see 6)
  reconciliation-service.ts   drift detection against the provider's own status
supabase/functions/
  payment-initialize/ payment-verify/ payment-webhook/ payment-transfer/
  payment-refund/ payment-status/ payment-reconciliation/    (all 7 named in the brief)
supabase/migrations/0062-0064
```

## 4. Payment Gateway Interface & Provider Manager

`PaymentProvider` (types.ts) has zero Paystack-specific shapes in its signatures -- `initializeTransaction`, `verifyTransaction`, `verifyWebhookSignature`, `createTransferRecipient`, `initiateTransfer`, `getTransferStatus`, `initiateRefund`, `lookupTransaction`. Adding Stripe/Flutterwave/Adyen/Wise later is: write `providers/stripe.ts` implementing this interface, add one line to `registry.ts`'s `PROVIDERS` map. Nothing in the 5 service files, Wallet Engine, or Escrow Engine changes -- this is what "future providers must be pluggable without changing Wallet or Escrow" means concretely, not just as a stated goal.

## 5. Paystack Provider

Every method calls Paystack's real REST API (not a stub): `/transaction/initialize`, `/transaction/verify/:ref`, HMAC-SHA512 webhook signing (Paystack signs with the same secret key used for API auth -- no separate webhook secret, unlike Stripe), `/transferrecipient`, `/transfer`, `/transfer/:ref`, `/refund`. Amounts pass through unconverted since Paystack's smallest-currency-unit convention matches this project's `_cents` convention directly.

## 6. Deposits, Withdrawals, Refunds

**Deposits**: initialize -> provider checkout -> webhook OR client poll (`payment-verify`) -> `verifyAndCompleteDeposit` re-verifies directly against Paystack's API (never trusts the webhook payload's claimed status) -> exactly one `completeDeposit()` call.

**Withdrawals**: a two-step ledger design -- `initiateWithdrawalHold` moves `available -> pending` the instant a withdrawal is requested (so the same money can never be spent twice while a transfer is in flight), then `settleWithdrawal`/`reverseWithdrawalHold` closes it out once the provider confirms success or failure.

**Refunds**: architecture-only, per the brief's own wording ("Refund Architecture," not "Refund Implementation") -- `providers/paystack.ts`'s `initiateRefund` calls Paystack's real endpoint, but no business logic decides *when* a refund should fire, since every in-platform refund scenario (cancelled challenges, voided matches, expired tournaments) already goes through `releaseFromEscrow` with `release_reason='refund_void'` and never touches an external provider at all -- that money never left the platform in the first place.

## 7. Webhooks

Two independent layers of verification, not one: HMAC signature check first, then `verifyAndCompleteDeposit`/`finalizeWithdrawal` re-verify against the provider's own API rather than trusting the webhook payload. Idempotency/duplicate/replay protection is a real unique constraint (`processed_payment_webhook_events`, `(provider, provider_event_id)`) -- a duplicate delivery hits a Postgres unique-violation, caught and treated as "already handled," not re-processed. The webhook handler reads the **raw** request body as text before any JSON parsing, since an HMAC is computed over exact bytes -- re-serializing a parsed object would corrupt the signature check, or worse, be tempting to "simplify" in a way that weakens the actual security boundary.

## 8. Edge Functions & APIs

All 7 named in the brief. `payment-webhook` has no JWT auth at all (Paystack has no user session) -- its only authentication is the signature check inside the service it calls, which is why it's structured as a bare `Deno.serve` rather than going through `withEdgeFunction`'s JWT-auth path.

## 9. Tests

Given this phase's own established pattern for DB/network-touching code, the genuinely verifiable-in-this-environment piece is structural: the grep-verified claims below (zero direct ledger writes, `completeDeposit` called exactly once and only post-verification). Provider/webhook/idempotency/replay/deposit/withdrawal/refund/load tests all need a live Paystack test-mode account and a live database -- consistent with every prior phase's honesty note about this container having no network access or Deno runtime.

## 10. Verification Checklist

- [x] Payment Layer never writes `wallet_ledger`/`wallet_transactions` directly -- verified by grep (zero matches outside the documented `payment_intents` bookkeeping)
- [x] `completeDeposit` called exactly once, only after provider verification succeeds -- verified by grep
- [x] Two real bugs (double-transaction-row on deposit, illegal-mutation-of-completed-row on withdrawal) found and fixed via `payment_intents`, not left latent for a live environment to discover
- [x] Webhook signature verified before any wallet effect; idempotency enforced by a real unique constraint, not an application-level check alone
- [x] Secrets (`PAYSTACK_SECRET_KEY`) read from environment only -- `getSecretKey()` throws loudly rather than falling back to a hardcoded value
- [x] Provider abstraction has zero Paystack-specific types in its public interface -- confirmed by reading `types.ts`
- [x] All new/modified files pass the full comment/string-aware bracket-balance check across the entire `supabase/functions` tree
- [x] Every cross-module import (`_payment` <-> `_wallet`/`_shared`) verified against real exports
- [x] Migration/rollback parity maintained (64/64)
- [ ] **Not verified in this environment**: no Deno runtime, no network, no live Paystack test-mode account -- same limitation as every prior phase.

## 11. Financial Security Review

Secret keys never leave the Deno Edge Function environment -- `providers/paystack.ts` is the only file that reads `PAYSTACK_SECRET_KEY`, and it's never returned in any response body or logged. Webhook signature verification happens before the unique-constraint idempotency check, which happens before any provider re-verification call, which happens before any wallet effect -- four sequential gates, any one of which failing stops the chain. Frontend-reported payment status is never trusted anywhere in this codebase: `payment-verify` and `payment-webhook` both funnel through the exact same `verifyAndCompleteDeposit`/`finalizeWithdrawal` functions, which always re-check against Paystack's own API regardless of which path called them.

## Stop point

PAYMENT-001 is complete. Per the established convention, stopping here -- not starting PROD-001 until you approve.
