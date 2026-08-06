// supabase/functions/_realtime/presence.ts
//
// HONESTY NOTE: "Online", "Typing", moment-to-moment "Away" pings are
// ephemeral and are Supabase Realtime's built-in Presence/Broadcast
// features — a client joins a channel (e.g. `presence:global` or
// `presence:challenge:{id}`) and Supabase tracks connected clients
// in-memory, with no server-side code needed for that part at all. This
// file only writes the two facts that must survive a disconnect: last_seen
// and (optionally) which challenge someone is currently in — both queried
// outside of an active Realtime session (e.g. "was my opponent online
// recently" shown on a profile).

import { getServiceRoleClient } from "../_shared/database/client.ts";
import type { PresenceStatus } from "./types.ts";

export async function updatePresence(
  userId: string,
  status: PresenceStatus,
  currentChallengeId: string | null,
  currentTournamentId: string | null = null,
): Promise<void> {
  const supabase = getServiceRoleClient();
  await supabase.from("user_presence").upsert(
    {
      user_id: userId,
      status,
      last_seen_at: new Date().toISOString(),
      current_challenge_id: currentChallengeId,
      current_tournament_id: currentTournamentId,
    },
    { onConflict: "user_id" },
  );
}

export async function getPresence(userId: string) {
  const supabase = getServiceRoleClient();
  const { data } = await supabase.from("v_public_presence").select("*").eq(
    "user_id",
    userId,
  ).maybeSingle();
  return data;
}

/**
 * Marks a user offline. Should be called from the client's disconnect
 * handler AND from a periodic sweep (a user whose last_seen_at is old but
 * whose status is still 'online' means their client vanished without a
 * clean disconnect — e.g. closing the laptop lid). The sweep itself is not
 * scheduled by default in this phase (see the deliverable's note on
 * sub-minute scheduling, the same gap CHALLENGE-001/TOURNAMENT-001
 * documented) but this function is what it would call.
 */
export async function markOffline(userId: string): Promise<void> {
  const supabase = getServiceRoleClient();
  await supabase.from("user_presence").update({ status: "offline" }).eq(
    "user_id",
    userId,
  );
}

const STALE_PRESENCE_MINUTES = 2;

export async function sweepStalePresence(): Promise<{ markedOffline: number }> {
  const supabase = getServiceRoleClient();
  const cutoff = new Date(Date.now() - STALE_PRESENCE_MINUTES * 60 * 1000)
    .toISOString();

  const { data, error } = await supabase
    .from("user_presence")
    .update({ status: "offline" })
    .neq("status", "offline")
    .lt("last_seen_at", cutoff)
    .select("user_id");

  if (error) {
    throw new Error(`Failed to sweep stale presence: ${error.message}`);
  }
  return { markedOffline: (data ?? []).length };
}
