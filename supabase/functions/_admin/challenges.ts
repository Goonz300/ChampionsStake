// supabase/functions/_admin/challenges.ts
//
// Reuses CHALLENGE-001/WALLET-001 primitives throughout. The one genuinely
// new capability is forceCancelChallenge -- CHALLENGE-001's own
// cancelChallenge is player-initiated and pre-accept only; this covers the
// admin case (any party may be refunded, any pre-live state), which never
// existed before this phase. Everything else here (archive, timeline) is a
// direct pass-through to existing CHALLENGE-001 functions -- no logic is
// duplicated, only exposed to an admin caller.

import { getServiceRoleClient } from "../_shared/database/client.ts";
import { ConflictError } from "../_shared/errors/index.ts";
import { recordAudit } from "../_shared/audit/index.ts";
import { releaseFromEscrow } from "../_wallet/transfer.ts";
import { getWalletIdForUser, getChallengeOrThrow, updateChallengeStatus, recordChallengeEvent } from "../_challenge/repository.ts";
import { archiveChallenge as challengeArchive, getChallengeTimeline as challengeTimeline } from "../_challenge/workflow.ts";

const FORCE_CANCELLABLE_STATUSES = [
  "draft", "published", "waiting", "accepted", "escrow_pending", "escrow_locked", "ready", "countdown",
];

/**
 * Admin-only force-cancel, refunding whichever participants have a locked
 * stake. Scope boundary (see migration 0056's comment): only allowed
 * pre-live -- once gameplay/claims are in progress, the correct path is
 * escrow-transition.ts's existing moderator_review route, not a raw
 * override.
 */
export async function forceCancelChallenge(challengeId: string, adminId: string, reason: string): Promise<void> {
  const challenge = await getChallengeOrThrow(challengeId);
  if (!FORCE_CANCELLABLE_STATUSES.includes(challenge.status)) {
    throw new ConflictError(
      `Challenge ${challengeId} cannot be force-cancelled from status "${challenge.status}" -- ` +
        `once live or a winner is submitted, use the moderator review path instead.`,
    );
  }

  const supabase = getServiceRoleClient();
  const { data: participants } = await supabase
    .from("challenge_participants")
    .select("user_id, stake_locked_cents")
    .eq("challenge_id", challengeId);

  for (const participant of participants ?? []) {
    if (!participant.stake_locked_cents) continue;
    const walletId = await getWalletIdForUser(participant.user_id);
    await releaseFromEscrow(
      walletId,
      walletId,
      participant.stake_locked_cents,
      0,
      "refund_void",
      { table: "challenges", id: challengeId },
      adminId,
      `admin-force-cancel-${challengeId}-${participant.user_id}`,
    );
  }

  await updateChallengeStatus(challengeId, { status: "cancelled", cancelledAt: new Date().toISOString() });
  await recordChallengeEvent(challengeId, "ChallengeCancelled", adminId, { reason, forced_by_admin: true });

  await recordAudit({
    actorId: adminId,
    actorType: "administrator",
    action: "ChallengeForceCancelled",
    category: "challenge",
    targetTable: "challenges",
    targetId: challengeId,
    metadata: { reason },
  });
}

export async function adminBrowseChallenges(filters: { status?: string; gameId?: string; limit: number; cursor?: string }) {
  const supabase = getServiceRoleClient();
  let query = supabase.from("challenges").select("*").order("created_at", { ascending: false }).limit(filters.limit);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.gameId) query = query.eq("game_id", filters.gameId);
  if (filters.cursor) query = query.lt("created_at", filters.cursor);

  const { data, error } = await query;
  if (error) throw new Error(`Failed to browse challenges: ${error.message}`);
  return data ?? [];
}

export const archiveChallengeAdmin = challengeArchive;
export const getChallengeTimelineAdmin = challengeTimeline;
