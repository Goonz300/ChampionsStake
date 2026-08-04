# ESCROW-001 — Escrow Engine & Challenge State Machine

**Process note**: no new phase-specific brief was provided for this phase. Per WALLET-001's closing line ("awaiting approval before ESCROW-001") and the Roadmap's own definition of this milestone (Phase 4.1: Escrow Schema & State Machine), I derived this phase's scope directly from the already-approved Business Rules §3 (Challenge Lifecycle) and §7 (Escrow Rules), keeping the same scope discipline as every prior phase — this is the escrow engine and the challenge state-machine transitions that drive it, not chat, disputes, tournaments, or admin tooling (separate Roadmap milestones 5.2, 5.3, 9, 6).

## 1. Architecture

The DB-001 schema (`challenges`, `challenge_participants`, `escrow_accounts`, `escrow_transactions`, and the `fn_challenge_state_guard` trigger) already existed — this phase builds the orchestration layer on top, reusing WALLET-001's `lockToEscrow`/`releaseFromEscrow` primitives rather than duplicating ledger logic. `_challenge/escrow-transition.ts` is the single implementation of "what happens when a challenge moves from state X to Y"; six thin Edge Functions (`challenge-publish`, `-accept`, `-ready`, `-declare-winner`, `-release`, `-cancel`) each call into it.

## 2. A real bug found and fixed while wiring this up

DB-001's `fn_challenge_state_guard` (approved in an earlier phase) was missing two edges that this engine's actual, expected flows need: `published → accepted` (the guard only allowed `waiting → accepted`, but Business Rules §3 describes `waiting` as merely an alias for `published`, not a state the engine separately transitions into) and `draft → cancelled` (a user must be able to discard a draft; challenges are never deleted per Business Rules §7/§15). Migration 0040 fixes both, with the bug explained in the migration's own header rather than silently patched. This is exactly the kind of "verified implementation issue" every prior phase's scope allowed correcting — it was caught by writing `escrow-transition.test.ts`'s edge cross-check, not discovered later at runtime.

## 3. Escrow Transitions Implemented

- **Publish** (`draft→published`): locks the creator's stake via `lockToEscrow`, creates the `escrow_accounts` row, records the `ChallengeCreated` event.
- **Accept** (`published→accepted→escrow_locked`): locks the opponent's stake, records both participants.
- **Ready check** (`escrow_locked→ready→live`): tracks per-participant `ready_at`; transitions to `live` automatically once both sides have confirmed.
- **Declare winner** (`live→winner_submitted`): uses a **conditional UPDATE** (`WHERE result_locked = false`) as the actual concurrency guard against a double win-claim — Postgres evaluates this atomically per row, so it's a real guarantee, not just an application-level check a second concurrent request could race past.
- **Release** (`winner_submitted→awaiting_confirmation→released→completed`): enforced non-claiming-party rule (the winner cannot self-release); two `releaseFromEscrow` calls — the winner's own stake returning to themselves (no fee) and the loser's stake moving to the winner minus a 7.5% platform fee (Business Rules §6 default).
- **Cancel** (pre-accept only, `draft/published/waiting→cancelled`): refunds the creator's locked stake if one exists.

**Scope boundary, stated explicitly**: mutual-approval cancellation *after* acceptance (Business Rules §7) is not implemented — that needs a negotiation flow (propose → other party approves) that belongs with the notification/chat layer, not the core state machine. Dispute-triggered transitions (`disputed`, `moderator_review`) are likewise out of scope — Roadmap Milestone 5.3.

## 4. Concurrency Protection

Two independent mechanisms, matching WALLET-001's pattern: (1) the ledger engine's row-locking already prevents double-spend on the underlying wallets; (2) `declareWinner`'s conditional UPDATE prevents two participants from both successfully claiming victory, independent of any wallet-level lock.

## 5. Tests

`escrow-transition.test.ts` — cross-checks every transition the engine actually performs against the (now-fixed) allowed-edge list, simulated in Python during development to confirm it passes before being committed as a Deno test. This is what caught the `published→accepted` and `draft→cancelled` gaps. Full end-to-end tests (declare-winner concurrency, release fee-split correctness, cancel refund correctness) need a live database — same documented limitation as every prior phase (no Deno runtime, no network in this container).

## 6. Verification Checklist

- [x] Every escrow-transition function reuses WALLET-001's ledger primitives — no direct `wallet_ledger`/`wallet_transactions` writes anywhere in `_challenge/`
- [x] Every state transition used by the engine verified against the state-machine guard's edge list (and two real gaps fixed, not just noted)
- [x] Non-claiming-party rule enforced in code (`challenge.winnerSubmittedBy === callerId` throws), not just documented
- [x] Concurrent double-win-claim protection is a real atomic conditional UPDATE, not an app-level check
- [x] All new files pass the same comment/string-aware bracket-balance check used in every prior phase, re-run across the full `supabase/functions` tree
- [x] All function calls between `_challenge`, `_wallet`, and `_shared` cross-checked against actual exports
- [ ] **Not verified in this environment**: no Deno runtime, no live Postgres — the fee-split math, the ready-check race, and the full publish→accept→ready→live→declare→release happy path all still need to run for real.

## Stop point

ESCROW-001 is complete. Stopping here per the same convention as every prior phase, awaiting your review before any further phase (Tournament Engine, Dispute/Moderation, Chat, or Admin tooling).
