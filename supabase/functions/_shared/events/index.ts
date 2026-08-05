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
  // Wallet Engine events (WALLET-001):
  | "WalletCreated"
  | "WalletUpdated"
  | "BalanceChanged"
  | "TransactionCompleted"
  | "TransactionFailed"
  // Framework-level events, actually emitted by this phase's own code:
  | "RateLimitProbe";

export interface DomainEvent<T = Record<string, unknown>> {
  type: DomainEventType | (string & {});
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
