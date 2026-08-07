# Escrow Architecture

## 1. Model

One `escrow_accounts` row per challenge (`challenge_id unique`) or tournament (`tournament_id unique`) — exactly one owner reference is set (`chk_escrow_accounts_exactly_one_owner`). Money itself lives in `wallet_ledger`'s `escrowed` sub-balance per wallet; `escrow_accounts`/`escrow_transactions` are the observability/audit mirror of that state, not a second source of truth for the money.

## 2. Challenge Escrow (1v1)

State machine (challenges.status), DB-enforced via a state-guard trigger:
```
draft → published → accepted → escrow_pending → escrow_locked → ready → countdown → live
  → winner_submitted → awaiting_confirmation → released → completed
```
Branches: `cancelled`, `expired`, `disputed`/`moderator_review`, `archived`.

- **Lock**: `publishChallenge` (creator's stake) and `acceptChallenge` (opponent's stake), both via `lockToEscrow`.
- **Release (mutual)**: `releaseFunds` → `distributeChallengeFunds` — winner's own stake returns fee-free, loser's stake goes to the winner minus a 7.5% platform fee. Two `releaseFromEscrow` calls, verified balanced by `_wallet/ledger.test.ts`'s "three-leg balanced transfer" test.
- **Release (moderator)**: `moderatorResolveDispute` reuses the *exact same* `distributeChallengeFunds` helper — moderators never touch financial tables directly, they call into the same Escrow Engine code path a normal release uses.
- **Void (moderator)**: `moderatorVoidMatch` refunds both parties in full via `releaseFromEscrow`, no fee.
- **Cancel (pre-accept)**: `cancelChallenge` refunds the creator's stake if one was locked.
- **Automatic release on timeout**: **not implemented** — release requires the non-claiming participant to actively call `releaseFunds` (mutual-confirmation model). No scheduler exists to auto-release after a timeout if the opponent never confirms. Not verified against Business Rules whether this is by design; flagged as an open question, not silently assumed either way.

## 3. Tournament Escrow (Pooled)

Distinct from challenge escrow: entry fees are collected **once per registrant**, into the **same** tournament-level `escrow_accounts` row (pooled, not one row per player). Individual bracket matches do not lock/release per-match stakes — that question was already settled at registration.

- **Lock**: `registerForTournament` → `lockToEscrow`, once per registrant.
- **Refund (pre-check-in withdrawal)**: `withdrawRegistration` → `releaseFromEscrow`, full refund, self-to-self.
- **Prize distribution (Phase 6 — see §4 below)**: `triggerPrizeDistribution`, releases every remaining registrant's stake and credits placement winners.

## 4. Phase 6 Fixes

### BUG C — Tournament Prize Distribution Was Never Implemented

Confirmed before this fix: `triggerPrizeDistribution` only emitted an event and moved the tournament to `completed`. The actual `releaseFromEscrow` calls were explicitly deferred, in the function's own comment, to "a payout coordinator that reacts to PrizeDistributionTriggered" — and grep confirmed **zero consumers of that event existed anywhere in the codebase**. Tournament winners were never actually paid by any code path.

**Fixed**: `triggerPrizeDistribution` (kept its exported name — only its implementation changed) now:
1. Derives standings from the completed bracket: champion + runner-up from the final match; 3rd place from the semifinal round's losers, tied and split evenly (standard bracket convention — this engine runs no third-place playoff). A `payout_structure` naming any other placement is refused outright, not guessed at.
2. Builds **one** balanced ledger transaction via `postBalancedEntries` directly (not `releaseFromEscrow`'s one-from/one-to signature, which doesn't fit a many-payers-to-few-winners pooled settlement): one debit leg per registrant's escrowed stake, up to three credit legs for the placement winners, and a `platform_fee_revenue` leg absorbing any shortfall (rounding, ties, or a `payout_structure` summing below 100%).
3. Records matching `escrow_accounts`/`escrow_transactions` bookkeeping per registrant (see BUG B below).

`computePayoutShares` is extracted as pure, database-free logic specifically so this financial math is directly unit-tested (4 tests, `_tournament/workflow.test.ts`) — floors at every step so credited shares can never exceed the pool.

### BUG B — escrow_accounts/escrow_transactions Were Never Updated

Confirmed before this fix: `escrow_accounts.status`/`total_locked_cents`/`released_at` were written once at row creation and never updated again (zero `.update()` calls anywhere). `escrow_transactions` had zero `INSERT` call sites at all, despite its own migration comment describing it as "an immutable log of every lock/release/refund/void event." Admin/moderator surfaces (`_admin/analytics.ts`, `_admin/dashboard.ts`, `_moderator/cases.ts`) that read these tables saw permanently-stale `"locked", total_locked_cents=0` data regardless of real state.

**Fixed**: new `_wallet/escrow-accounts.ts` (`recordEscrowLock`/`recordEscrowRelease`), called from *inside* `lockToEscrow`/`releaseFromEscrow` (`transfer.ts`) — the one choke point every escrow lock/release, for both challenges and tournaments, already passes through — rather than scattered across every individual call site. `fn_adjust_escrow_locked` (migration 0082) performs the counter update as a single atomic `UPDATE` statement (not an application-level read-then-write), required because tournament escrow is pooled: multiple registrants' locks concurrently increment the same row.

**Transition note**: decrements are clamped at zero to tolerate `escrow_accounts` rows created *before* this fix, whose `total_locked_cents` was never previously tracked and would otherwise go negative on their first post-fix release (violating `chk_escrow_accounts_total_nonneg`). This means a challenge/tournament that was already escrow-locked before this migration deployed will show an inaccurately-low `total_locked_cents` until that specific escrow fully releases, at which point it self-heals to the correct terminal state. One-time transition, not an ongoing gap.

## 5. What Was NOT Touched

Every state transition, every business rule around who may release funds and when, and the four-eyes-equivalent "only the non-claiming party may release" rule were already correct and are unchanged. Phase 6 added bookkeeping accuracy and closed the prize-distribution gap; it did not redesign the escrow state machine.
