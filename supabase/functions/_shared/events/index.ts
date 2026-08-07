// supabase/functions/_shared/events/index.ts
//
// HONESTY NOTE (read this before using or extending this module): a
// traditional in-memory event bus (register handlers, emit() calls them
// synchronously) does not work correctly in a serverless Edge Function,
// because each invocation is a fresh, isolated process — handlers
// registered in one invocation do not exist in the next one. `emit()`
// below therefore does two things: (1) durably records the event in
// `domain_events` (migration 0034), which is the actual source of truth any
// future consumer reads from, and (2) optionally invokes handlers
// registered via `onWithinRequest()` for same-invocation side effects only
// (e.g. "also increment a metric" within the same function call) — it is
// NOT a substitute for a real subscriber and must never be relied on for
// anything that needs to survive past the current request.

import { getServiceRoleClient } from "../database/client.ts";
import { logger } from "../logger/index.ts";

export type DomainEventType =
  | "UserRegistered"
  | "ChallengeCreated"
  | "ChallengeAccepted"
  | "EscrowLocked"
  | "EscrowReleased"
  | "FundsReleased"
  | "DisputeOpened"
  | "ModeratorDecisionRecorded"
  | "NotificationQueued"
  | "TournamentStarted"
  | "TournamentRoundCompleted"
  // Phase 4 event-contract fix: these were previously emitted under
  // whichever pre-existing type happened to be nearby (e.g. readyCheck's
  // two distinct sub-events both emitted "ChallengeAccepted", with the
  // real event name only in payload.event) -- any type-dispatching
  // consumer (EVENT_RULES below) could not distinguish them. Each now has
  // its own real type; payload.event fields were left in place rather
  // than removed, since they're harmless and some callers may already
  // read them.
  | "ChallengeReadyStarted"
  | "ChallengeCountdownStarted"
  | "ChallengeMatchStarted"
  | "ChallengeWinnerSubmitted"
  | "ChallengeCompleted"
  | "ChallengeCancelled"
  | "ChallengeExpired"
  | "ChallengeArchived"
  | "AnnouncementPublished"
  // Phase 6 event-contract fix: matching the exact Phase 4 fix above for
  // challenge events -- triggerPrizeDistribution previously emitted
  // type:"TournamentStarted" for both of these, with the real event name
  // only in payload.event, so no type-dispatching consumer could ever
  // actually subscribe to "a tournament's prizes were distributed" or "a
  // tournament completed."
  | "TournamentPrizeDistributionTriggered"
  | "TournamentPrizesDistributed"
  | "TournamentCompleted"
  // Wallet Engine events (WALLET-001):
  | "WalletCreated"
  | "WalletUpdated"
  | "BalanceChanged"
  | "TransactionCompleted"
  | "TransactionFailed"
  // Phase 7 (AI-002) event-contract fix: settleWithdrawal/reverseWithdrawalHold
  // previously emitted the generic "TransactionCompleted" type for both a
  // successful settlement and a reversed (failed) withdrawal, distinguished
  // only by an unread payload.type string -- the exact same mislabeled-emit
  // shape already fixed once for challenge events (Phase 4) and once for
  // tournament events (Phase 6). Trust Engine v2 is the first consumer that
  // actually needs to dispatch on "did this withdrawal succeed or fail" by
  // type, which is what surfaced it here.
  | "WithdrawalSettled"
  | "WithdrawalReversed"
  // Phase 7 (AI-002): genuinely new signals, not previously emitted under
  // any type.
  | "TournamentNoShowRecorded"
  | "ChargebackRecorded"
  | "SanctionsScreeningBlocked"
  // Phase 8 (TOURNAMENT-003): Team Platform events.
  | "TeamInvitationSent"
  | "TeamOwnershipTransferred"
  // Phase 8 (TOURNAMENT-005): Season Platform events.
  | "SeasonEnded"
  // Phase 8 (TOURNAMENT-007): Organizer Platform events.
  | "TournamentInvitationSent"
  // Framework-level events, actually emitted by this phase's own code:
  | "RateLimitProbe";

export interface DomainEvent<T = Record<string, unknown>> {
  type: DomainEventType | (string & Record<never, never>);
  payload: T;
  correlationId?: string;
  emittedBy: string;
}

type Handler = (event: DomainEvent) => void | Promise<void>;

const withinRequestHandlers: Handler[] = [];

/** Registers a handler for the current invocation only. Cleared per
 * invocation by middleware/compose.ts — do not rely on this across requests. */
export function onWithinRequest(handler: Handler): void {
  withinRequestHandlers.push(handler);
}

export function clearWithinRequestHandlers(): void {
  withinRequestHandlers.length = 0;
}

export async function emit<T = Record<string, unknown>>(
  event: DomainEvent<T>,
): Promise<void> {
  const supabase = getServiceRoleClient();

  const { error } = await supabase.from("domain_events").insert({
    event_type: event.type,
    payload: event.payload as Record<string, unknown>,
    correlation_id: event.correlationId ?? null,
    emitted_by: event.emittedBy,
  });

  if (error) {
    logger.error("Failed to record domain event", {
      error: error.message,
      eventType: event.type,
    });
  }

  for (const handler of withinRequestHandlers) {
    try {
      await handler(event as DomainEvent);
    } catch (err) {
      logger.error("Within-request event handler threw", {
        error: err instanceof Error ? err.message : String(err),
        eventType: event.type,
      });
    }
  }
}
