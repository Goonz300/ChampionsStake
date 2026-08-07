# Settlement Flow

How money actually moves for each terminal event, end to end.

## Challenge Settlement (Mutual Release)

```
declareWinner (result_locked=true, atomic compare-and-swap guard)
  → releaseFunds (called by the NON-claiming party only)
    → distributeChallengeFunds
      → releaseFromEscrow(winner, winner, stake, fee=0)      [winner's own stake back]
      → releaseFromEscrow(loser, winner, stake, fee=7.5%)     [loser's stake, minus fee, to winner]
    → escrow_accounts transitions to 'released' once total_locked_cents reaches 0 (Phase 6)
  → completeChallenge (released → completed)
```

## Challenge Settlement (Moderator Decision)

Identical money-movement code path (`distributeChallengeFunds`), different caller (`moderatorResolveDispute`) and `releaseReason` (`moderator_decision` instead of `mutual_release`). Moderators never touch `wallet_ledger` or `escrow_accounts` directly.

## Tournament Prize Settlement (Phase 6)

```
completeRound (final round) → tournaments.status = 'prize_distribution'
  → triggerPrizeDistribution
    → getFinalStandings (derives 1st/2nd/3rd from the bracket)
    → computePayoutShares (pure math: floors, never exceeds the pool)
    → postBalancedEntries: N debit legs (every registrant's stake) +
        up to 3 credit legs (placement winners) + platform_fee_revenue
        leg for any shortfall — ONE atomic transaction
    → recordEscrowRelease per registrant (escrow_accounts bookkeeping)
    → tournaments.status = 'completed'
```

See [ESCROW_ARCHITECTURE.md](ESCROW_ARCHITECTURE.md) §4 for why this uses `postBalancedEntries` directly rather than `releaseFromEscrow`.

## Deposit Settlement

```
payment-initialize → provider.initializeTransaction → payment_intents (status=pending)
  ↓ (user completes payment on Paystack's hosted page)
Paystack webhook (HMAC-verified) → webhook-service.ts
  → deposit-service.ts re-verifies against Paystack's OWN API (never trusts the webhook payload alone)
  → completeDeposit (wallet_ledger: platform_clearing debit, wallet available credit)
  → payment_intents.status = completed
```

## Withdrawal Settlement (Below Manual-Review Threshold)

```
payment-transfer (withdraw) → requestWithdrawal
  → assertWithinWithdrawalLimits (Phase 6: daily/monthly caps)
  → assertNotSanctioned (Phase 6: blocklist screening)
  → initiateWithdrawalHold (available → pending, funds safely on hold)
  → provider.initiateTransfer (money actually leaves via Paystack)
  → payment_intents (status=pending, provider_ref set)
  ↓ (Paystack webhook confirms success/failure)
finalizeWithdrawal
  success → settleWithdrawal (pending → gone, hold consumed)
  failure → reverseWithdrawalHold (pending → available, funds returned)
```

## Withdrawal Settlement (At/Above Manual-Review Threshold — Phase 6)

```
requestWithdrawal
  → initiateWithdrawalHold (funds on hold, SAME as below-threshold path)
  → payment_intents (status='pending_review') -- provider.initiateTransfer NOT called yet
  ↓ (administrator reviews via admin-wallets pending_review_withdrawals view)
approveHeldWithdrawal                       OR    rejectHeldWithdrawal
  → provider.initiateTransfer NOW                 → reverseWithdrawalHold (funds returned)
  → payment_intents.status = pending               → payment_intents.status = failed
  → (then the same webhook-driven finalize path as above)
```

The critical distinction: for a below-threshold withdrawal, money leaves the platform automatically. For an at/above-threshold withdrawal, money never leaves until a human explicitly approves it — the hold protects the funds either way, but the provider call (the point of no return) only happens after review.
