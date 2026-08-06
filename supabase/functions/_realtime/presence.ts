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
import { isParticipant } from "../_challenge/repository.ts";
import type { PresenceStatus } from "./types.ts";

async function isTournamentRegistrant(
  tournamentId: string,
  userId: string,
): Promise<boolean> {
  const supabase = getServiceRoleClient();
  const { count } = await supabase
    .from("tournament_registrations")
    .select("id", { count: "exact", head: true })
    .eq("tournament_id", tournamentId)
    .eq("user_id", userId);
  return (count ?? 0) > 0;
}

/**
 * Phase 4 independent-review finding: neither currentChallengeId nor (the
 * newly-added) currentTournamentId was ever verified against the
 * caller's actual participation -- a caller could claim presence in a
 * challenge/tournament they have nothing to do with. The practical impact
 * is narrow (this only affects who can see a self-reported status/
 * last-seen via user_presence's participant-scoped RLS policies, not
 * financial/PII data) but it is a real, avoidable authorization gap in a
 * function this phase already touches, so it's closed here rather than
 * just noted: an unverified id is silently dropped to null (fails safe --
 * the write still succeeds, just without that context) rather than
 * rejecting the whole presence update over a stale/incorrect id, which
 * would be a worse experience for a legitimate client racing a state
 * change (e.g. reporting a challenge as "current" the instant before
 * their own participant row is visible).
 */
export async function updatePresence(
  userId: string,
  status: PresenceStatus,
  currentChallengeId: string | null,
  currentTournamentId: string | null = null,
): Promise<void> {
  const supabase = getServiceRoleClient();

  const verifiedChallengeId = currentChallengeId &&
      (await isParticipant(currentChallengeId, userId))
    ? currentChallengeId
    : null;
  const verifiedTournamentId = currentTournamentId &&
      (await isTournamentRegistrant(currentTournamentId, userId))
    ? currentTournamentId
    : null;

  await supabase.from("user_presence").upsert(
    {
      user_id: userId,
      status,
      last_seen_at: new Date().toISOString(),
      current_challenge_id: verifiedChallengeId,
      current_tournament_id: verifiedTournamentId,
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
