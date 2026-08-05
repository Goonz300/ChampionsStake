// supabase/functions/_challenge/workflow.ts
//
// Everything about a challenge that ISN'T an escrow-coupled state
// transition: creation/editing/deletion of drafts, discovery/search,
// timeline retrieval, expiry, and archiving. Kept separate from
// escrow-transition.ts so that file stays focused on the state machine +
// money movement, and this one on CRUD/read/scheduling concerns.

import { z } from "npm:zod@3.24.1";
import { getServiceRoleClient } from "../_shared/database/client.ts";
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
} from "../_shared/errors/index.ts";
import { recordAudit } from "../_shared/audit/index.ts";
import { emit } from "../_shared/events/index.ts";
import {
  getChallengeOrThrow,
  getWalletIdForUser,
  recordChallengeEvent,
  updateChallengeStatus,
} from "./repository.ts";
import { releaseFromEscrow } from "../_wallet/transfer.ts";

export const createChallengeSchema = z.object({
  gameId: z.string().uuid(),
  matchType: z.string().min(1).max(100),
  stakeCents: z.number().int().positive(),
  visibility: z.enum(["public", "private", "friends"]),
  platformCode: z.string().min(1),
  regionCode: z.string().min(1),
});
export type CreateChallengeInput = z.infer<typeof createChallengeSchema>;

export const updateChallengeSchema = createChallengeSchema.partial();
export type UpdateChallengeInput = z.infer<typeof updateChallengeSchema>;

/** Creates a new draft. No escrow, no visibility to anyone else yet — a
 * draft is purely the creator's own in-progress configuration. */
export async function createChallenge(
  creatorId: string,
  input: CreateChallengeInput,
): Promise<{ id: string }> {
  const supabase = getServiceRoleClient();

  const { data, error } = await supabase
    .from("challenges")
    .insert({
      creator_id: creatorId,
      game_id: input.gameId,
      match_type: input.matchType,
      stake_cents: input.stakeCents,
      visibility: input.visibility,
      platform_code: input.platformCode,
      region_code: input.regionCode,
      status: "draft",
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Failed to create challenge draft: ${error?.message}`);
  }

  await recordChallengeEvent(data.id, "ChallengeDraftCreated", creatorId);
  await recordAudit({
    actorId: creatorId,
    actorType: "user",
    action: "ChallengeDraftCreated",
    category: "challenge",
    targetTable: "challenges",
    targetId: data.id,
  });

  return { id: data.id };
}

/** Edits a draft. Business Rules §3: editing is only ever legal while the
 * challenge is still in 'draft' — every other state is a blocked action. */
export async function updateChallenge(
  challengeId: string,
  callerId: string,
  input: UpdateChallengeInput,
): Promise<void> {
  const challenge = await getChallengeOrThrow(challengeId);

  if (challenge.creatorId !== callerId) {
    throw new AuthorizationError("Only the creator may edit this challenge.");
  }
  if (challenge.status !== "draft") {
    throw new ConflictError(
      `Challenge ${challengeId} can only be edited while in 'draft' (current: ${challenge.status}).`,
    );
  }

  const supabase = getServiceRoleClient();
  const update: Record<string, unknown> = {};
  if (input.gameId) update.game_id = input.gameId;
  if (input.matchType) update.match_type = input.matchType;
  if (input.stakeCents) update.stake_cents = input.stakeCents;
  if (input.visibility) update.visibility = input.visibility;
  if (input.platformCode) update.platform_code = input.platformCode;
  if (input.regionCode) update.region_code = input.regionCode;

  const { error } = await supabase.from("challenges").update(update).eq(
    "id",
    challengeId,
  );
  if (error) {
    throw new Error(
      `Failed to update challenge ${challengeId}: ${error.message}`,
    );
  }

  await recordChallengeEvent(challengeId, "ChallengeEdited", callerId, {
    fields: Object.keys(update),
  });
  await recordAudit({
    actorId: callerId,
    actorType: "user",
    action: "ChallengeEdited",
    category: "challenge",
    targetTable: "challenges",
    targetId: challengeId,
    metadata: update,
  });
}

/**
 * Deletes a challenge. SCOPE-CRITICAL: only a 'draft' with no escrow
 * account may be hard-deleted — every other status must be cancelled
 * instead (escrow-transition.ts's cancelChallenge), never deleted, per
 * Business Rules §7/§15 ("challenges are never deleted"). A pure draft
 * never touched a wallet, so deleting it doesn't violate that principle;
 * this function enforces that boundary rather than trusting the caller.
 */
export async function deleteChallenge(
  challengeId: string,
  callerId: string,
): Promise<void> {
  const challenge = await getChallengeOrThrow(challengeId);

  if (challenge.creatorId !== callerId) {
    throw new AuthorizationError("Only the creator may delete this challenge.");
  }
  if (challenge.status !== "draft") {
    throw new ConflictError(
      `Challenge ${challengeId} has status "${challenge.status}" — only a draft may be deleted. Use cancel instead.`,
    );
  }

  const supabase = getServiceRoleClient();
  const { error } = await supabase.from("challenges").delete().eq(
    "id",
    challengeId,
  ).eq("status", "draft");
  if (error) {
    throw new Error(
      `Failed to delete challenge ${challengeId}: ${error.message}`,
    );
  }

  await recordAudit({
    actorId: callerId,
    actorType: "user",
    action: "ChallengeDeleted",
    category: "challenge",
    targetTable: "challenges",
    targetId: challengeId,
  });
}

/** Duplicates a challenge's configuration into a new draft (not its
 * status/participants/escrow — those never carry over). */
export async function duplicateChallenge(
  challengeId: string,
  callerId: string,
): Promise<{ id: string }> {
  const supabase = getServiceRoleClient();
  const { data: fullOriginal, error } = await supabase
    .from("challenges")
    .select(
      "game_id, match_type, stake_cents, visibility, platform_code, region_code",
    )
    .eq("id", challengeId)
    .single();

  if (error || !fullOriginal) {
    throw new NotFoundError(`Challenge ${challengeId} does not exist.`);
  }

  return createChallenge(callerId, {
    gameId: fullOriginal.game_id,
    matchType: fullOriginal.match_type,
    stakeCents: fullOriginal.stake_cents,
    visibility: fullOriginal.visibility,
    platformCode: fullOriginal.platform_code,
    regionCode: fullOriginal.region_code,
  });
}

/** Server-authoritative expiry: published/waiting challenges past their
 * expires_at with no opponent, refunding the creator's locked stake. Called
 * by the challenge-expire scheduler, not by any client. */
export async function expireChallenge(challengeId: string): Promise<void> {
  const challenge = await getChallengeOrThrow(challengeId);
  if (challenge.status !== "published" && challenge.status !== "waiting") {
    throw new ConflictError(
      `Challenge ${challengeId} is not in an expirable state (current: ${challenge.status}).`,
    );
  }

  const walletId = await getWalletIdForUser(challenge.creatorId);
  await releaseFromEscrow(
    walletId,
    walletId,
    challenge.stakeCents,
    0,
    "auto_expiry",
    { table: "challenges", id: challengeId },
    null,
    `expire-refund-${challengeId}`,
  );

  await updateChallengeStatus(challengeId, { status: "expired" });
  await recordChallengeEvent(challengeId, "ChallengeExpired", null);

  await recordAudit({
    actorId: null,
    actorType: "system",
    action: "ChallengeExpired",
    category: "challenge",
    targetTable: "challenges",
    targetId: challengeId,
  });

  await emit({
    type: "ChallengeCreated",
    payload: { challengeId, event: "ChallengeExpired" },
    emittedBy: "challenge-expire",
  });
}

/** Archives a terminal challenge (completed/cancelled/expired -> archived).
 * Called by the challenge-archive scheduler after a retention window. */
export async function archiveChallenge(challengeId: string): Promise<void> {
  const challenge = await getChallengeOrThrow(challengeId);
  if (!["completed", "cancelled", "expired"].includes(challenge.status)) {
    throw new ConflictError(
      `Challenge ${challengeId} is not in an archivable state (current: ${challenge.status}).`,
    );
  }

  await updateChallengeStatus(challengeId, { status: "archived" });
  await recordChallengeEvent(challengeId, "ChallengeArchived", null);
  await emit({
    type: "ChallengeCreated",
    payload: { challengeId, event: "ChallengeArchived" },
    emittedBy: "challenge-archive",
  });
}

export interface DiscoveryFilter {
  gameId?: string;
  platformCode?: string;
  regionCode?: string;
  minStakeCents?: number;
  maxStakeCents?: number;
  sort:
    | "trending"
    | "newest"
    | "highest_prize"
    | "region"
    | "friends"
    | "recommended";
  userId?: string; // required for 'friends'/'recommended'
  cursor?: string;
  limit: number;
}

/**
 * Discovery/search across public, open challenges. "Trending" and
 * "Recommended" are both approximated here (a real trending/recommendation
 * algorithm is an AI-phase concern, explicitly out of scope for this
 * phase) — both fall back to newest-first, stated plainly rather than
 * faking a scoring model that doesn't exist yet.
 */
export async function browseChallenges(filter: DiscoveryFilter) {
  const supabase = getServiceRoleClient();

  let query = supabase
    .from("challenges")
    .select(
      "id, creator_id, game_id, stake_cents, visibility, status, platform_code, region_code, created_at",
    )
    .in("status", ["published", "waiting"])
    .eq("visibility", "public")
    .limit(filter.limit);

  if (filter.gameId) query = query.eq("game_id", filter.gameId);
  if (filter.platformCode) {
    query = query.eq("platform_code", filter.platformCode);
  }
  if (filter.regionCode) query = query.eq("region_code", filter.regionCode);
  if (filter.minStakeCents) {
    query = query.gte("stake_cents", filter.minStakeCents);
  }
  if (filter.maxStakeCents) {
    query = query.lte("stake_cents", filter.maxStakeCents);
  }
  if (filter.cursor) query = query.lt("created_at", filter.cursor);

  switch (filter.sort) {
    case "highest_prize":
      query = query.order("stake_cents", { ascending: false });
      break;
    case "newest":
    case "trending": // approximated as newest — see function comment
    case "recommended": // approximated as newest — see function comment
    case "region":
    case "friends":
    default:
      query = query.order("created_at", { ascending: false });
  }

  if (filter.sort === "friends" && filter.userId) {
    const { data: friendRows } = await supabase
      .from("friends")
      .select("requester_id, addressee_id")
      .eq("status", "accepted")
      .or(`requester_id.eq.${filter.userId},addressee_id.eq.${filter.userId}`);

    const friendIds = (friendRows ?? []).map((f) =>
      f.requester_id === filter.userId ? f.addressee_id : f.requester_id
    );
    if (friendIds.length === 0) return [];
    query = query.in("creator_id", friendIds);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to browse challenges: ${error.message}`);
  return data ?? [];
}

/** Full event timeline for a challenge (challenge_events, chronological). */
export async function getChallengeTimeline(challengeId: string) {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("challenge_events")
    .select("*")
    .eq("challenge_id", challengeId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(
      `Failed to fetch timeline for challenge ${challengeId}: ${error.message}`,
    );
  }
  if (!data) {
    throw new NotFoundError(`No timeline found for challenge ${challengeId}.`);
  }
  return data;
}

export async function pinChallenge(
  userId: string,
  challengeId: string,
): Promise<void> {
  const supabase = getServiceRoleClient();
  const { error } = await supabase.from("challenge_pins").upsert({
    user_id: userId,
    challenge_id: challengeId,
  });
  if (error) throw new Error(`Failed to pin challenge: ${error.message}`);
}

export async function unpinChallenge(
  userId: string,
  challengeId: string,
): Promise<void> {
  const supabase = getServiceRoleClient();
  await supabase.from("challenge_pins").delete().eq("user_id", userId).eq(
    "challenge_id",
    challengeId,
  );
}
