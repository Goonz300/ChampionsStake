// supabase/functions/_challenge/repository.ts

import { getServiceRoleClient } from "../_shared/database/client.ts";
import { NotFoundError } from "../_shared/errors/index.ts";
import type { Challenge, EscrowAccount } from "./types.ts";

function toChallenge(row: Record<string, unknown>): Challenge {
  return {
    id: row.id as string,
    creatorId: row.creator_id as string,
    opponentId: row.opponent_id as string | null,
    gameId: row.game_id as string,
    stakeCents: row.stake_cents as number,
    visibility: row.visibility as Challenge["visibility"],
    status: row.status as Challenge["status"],
    resultLocked: row.result_locked as boolean,
    winnerSubmittedBy: row.winner_submitted_by as string | null,
    readyDeadlineAt: row.ready_deadline_at as string | null,
    expiresAt: row.expires_at as string | null,
  };
}

export async function getChallengeOrThrow(challengeId: string): Promise<Challenge> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase.from("challenges").select("*").eq("id", challengeId).maybeSingle();

  if (error) throw new Error(`Failed to fetch challenge ${challengeId}: ${error.message}`);
  if (!data) throw new NotFoundError(`Challenge ${challengeId} does not exist.`);
  return toChallenge(data);
}

export async function getWalletIdForUser(userId: string): Promise<string> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase.from("wallets").select("id").eq("user_id", userId).maybeSingle();

  if (error || !data) throw new NotFoundError(`No wallet exists for user ${userId}.`);
  return data.id as string;
}

export async function getOrCreateEscrowAccount(challengeId: string): Promise<EscrowAccount> {
  const supabase = getServiceRoleClient();

  const { data: existing } = await supabase
    .from("escrow_accounts")
    .select("*")
    .eq("challenge_id", challengeId)
    .maybeSingle();

  if (existing) {
    return {
      id: existing.id,
      challengeId: existing.challenge_id,
      tournamentId: existing.tournament_id,
      status: existing.status,
      totalLockedCents: existing.total_locked_cents,
    };
  }

  const { data: created, error } = await supabase
    .from("escrow_accounts")
    .insert({ challenge_id: challengeId, status: "locked", total_locked_cents: 0 })
    .select("*")
    .single();

  if (error || !created) throw new Error(`Failed to create escrow account for challenge ${challengeId}: ${error?.message}`);

  return {
    id: created.id,
    challengeId: created.challenge_id,
    tournamentId: created.tournament_id,
    status: created.status,
    totalLockedCents: created.total_locked_cents,
  };
}

export async function updateChallengeStatus(
  challengeId: string,
  fields: Partial<{
    status: string;
    resultLocked: boolean;
    winnerSubmittedBy: string | null;
    winnerSubmittedAt: string;
    readyDeadlineAt: string | null;
    acceptedAt: string;
    liveStartedAt: string;
    completedAt: string;
    cancelledAt: string;
    releaseReason: string;
  }>,
): Promise<void> {
  const supabase = getServiceRoleClient();

  const columnMap: Record<string, string> = {
    status: "status",
    resultLocked: "result_locked",
    winnerSubmittedBy: "winner_submitted_by",
    winnerSubmittedAt: "winner_submitted_at",
    readyDeadlineAt: "ready_deadline_at",
    acceptedAt: "accepted_at",
    liveStartedAt: "live_started_at",
    completedAt: "completed_at",
    cancelledAt: "cancelled_at",
    releaseReason: "release_reason",
  };

  const update: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    update[columnMap[key] ?? key] = value;
  }

  const { error } = await supabase.from("challenges").update(update).eq("id", challengeId);
  // Note: this UPDATE is subject to DB-001's fn_challenge_state_guard
  // trigger — an invalid status transition raises a Postgres error here,
  // which surfaces as a generic Error and should be normalized by the
  // calling Edge Function into a ChallengeError/ConflictError.
  if (error) throw new Error(`Failed to update challenge ${challengeId}: ${error.message}`);
}

export async function recordChallengeEvent(
  challengeId: string,
  eventType: string,
  actorId: string | null,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const supabase = getServiceRoleClient();
  await supabase.from("challenge_events").insert({
    challenge_id: challengeId,
    event_type: eventType,
    actor_id: actorId,
    metadata,
  });
}

export async function upsertParticipant(
  challengeId: string,
  userId: string,
  role: "creator" | "opponent",
  stakeLockedCents: number,
): Promise<void> {
  const supabase = getServiceRoleClient();
  const { error } = await supabase
    .from("challenge_participants")
    .upsert(
      { challenge_id: challengeId, user_id: userId, role, stake_locked_cents: stakeLockedCents },
      { onConflict: "challenge_id,user_id" },
    );
  if (error) throw new Error(`Failed to record participant: ${error.message}`);
}

export async function isParticipant(challengeId: string, userId: string): Promise<boolean> {
  const supabase = getServiceRoleClient();
  const { data } = await supabase
    .from("challenge_participants")
    .select("user_id")
    .eq("challenge_id", challengeId)
    .eq("user_id", userId)
    .maybeSingle();
  return Boolean(data);
}
