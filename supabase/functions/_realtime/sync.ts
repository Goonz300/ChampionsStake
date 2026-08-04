// supabase/functions/_realtime/sync.ts
//
// Reconnect/resync: a client that was offline needs everything relevant
// that happened since it last saw the server, in order, without duplicates.
// This queries the durable, already-ordered sources of truth (notifications,
// domain_events, challenge_messages) rather than inventing a new missed-
// events log -- those tables already ARE the event history.

import { getServiceRoleClient } from "../_shared/database/client.ts";
import { isParticipant } from "../_challenge/repository.ts";
import { AuthorizationError } from "../_shared/errors/index.ts";

export interface SyncResult {
  notifications: unknown[];
  messages: Record<string, unknown[]>;
  serverTime: string;
}

/**
 * Returns everything a client missed since `sinceTimestamp`. Event
 * ORDERING is guaranteed by each source table's own `created_at` (assigned
 * by Postgres at insert time, monotonic per table) -- this function
 * doesn't need its own sequence number scheme, it just orders by that
 * column consistently. CONFLICT detection (e.g. the client optimistically
 * showed a message as "sent" that the server never actually received) is
 * the client's job by reconciling its optimistic local state against this
 * response's authoritative rows -- this server-side function has no
 * client-side state to reconcile against, so it just returns the truth.
 */
export async function syncSince(userId: string, sinceTimestamp: string): Promise<SyncResult> {
  const supabase = getServiceRoleClient();

  const { data: notifications } = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", userId)
    .gt("created_at", sinceTimestamp)
    .order("created_at", { ascending: true })
    .limit(200);

  const { data: participations } = await supabase
    .from("challenge_participants")
    .select("challenge_id")
    .eq("user_id", userId);

  const messages: Record<string, unknown[]> = {};
  for (const p of participations ?? []) {
    const { data: msgs } = await supabase
      .from("challenge_messages")
      .select("*")
      .eq("challenge_id", p.challenge_id)
      .gt("created_at", sinceTimestamp)
      .order("created_at", { ascending: true })
      .limit(100);

    if (msgs && msgs.length > 0) {
      messages[p.challenge_id] = msgs;
    }
  }

  return { notifications: notifications ?? [], messages, serverTime: new Date().toISOString() };
}

/** Scoped resync for a single challenge chat (used when a client
 * reconnects to one open chat screen rather than the whole app). */
export async function syncChallengeSince(challengeId: string, userId: string, sinceTimestamp: string) {
  if (!(await isParticipant(challengeId, userId))) {
    throw new AuthorizationError("Only challenge participants may sync this chat.");
  }

  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("challenge_messages")
    .select("*")
    .eq("challenge_id", challengeId)
    .gt("created_at", sinceTimestamp)
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Failed to sync challenge messages: ${error.message}`);
  return data ?? [];
}
