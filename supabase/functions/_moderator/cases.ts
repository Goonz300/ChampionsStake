// supabase/functions/_moderator/cases.ts
//
// This file reads from every prior phase's tables directly (challenges,
// challenge_events, challenge_messages, escrow_accounts, dispute_evidence,
// audit_logs) but writes to none of them -- case management is a read
// aggregation, not a new source of truth. The one exception is chat: it
// can't call REALTIME-001's own getMessages() because that function gates
// access to PARTICIPANTS only (isParticipant check); a moderator reviewing
// a dispute is explicitly NOT a participant, so this file has its own
// moderator-scoped read (same query shape, different authorization
// condition, not duplicated business logic -- reading chat history is a
// SELECT, not a workflow).

import { getServiceRoleClient } from "../_shared/database/client.ts";
import { AuthorizationError } from "../_shared/errors/index.ts";
import { getChallengeTimeline } from "../_challenge/workflow.ts";
import { getDisputeOrThrow } from "./repository.ts";
import { isModeratorAllowedOnDispute } from "./authorization-heuristics.ts";

/**
 * Hostile review finding (High, Phase 8.5): this function's condition was
 * inverted -- it `return`ed (allowed access) in exactly the branch meant
 * to DENY it (someone else is assigned), and never threw under any input.
 * Combined with decisions.ts/notes.ts never calling this at all, dispute
 * assignment (queue.ts's claimDispute/assignDispute, whose own
 * "already assigned to another moderator" ConflictError only made sense
 * if downstream actions actually respected it) was purely cosmetic --
 * any active moderator could read or act on any dispute regardless of
 * assignment, overriding whoever was already reviewing it. Fixed to
 * actually throw, and exported so decisions.ts/notes.ts can reuse this
 * one check rather than each re-deriving it.
 */
export async function assertModeratorOnDispute(
  disputeId: string,
  moderatorId: string,
  isAdmin: boolean,
): Promise<void> {
  if (isAdmin) return;
  const dispute = await getDisputeOrThrow(disputeId);
  if (
    !isModeratorAllowedOnDispute(
      dispute.assignedModeratorId,
      moderatorId,
      isAdmin,
    )
  ) {
    throw new AuthorizationError(
      "This dispute is assigned to a different moderator.",
    );
  }
}

export async function getCaseDetail(
  disputeId: string,
  moderatorId: string,
  isAdmin: boolean,
) {
  await assertModeratorOnDispute(disputeId, moderatorId, isAdmin);

  const supabase = getServiceRoleClient();
  const dispute = await getDisputeOrThrow(disputeId);

  const { data: challenge } = await supabase.from("challenges").select("*").eq(
    "id",
    dispute.challengeId,
  ).single();
  const { data: participants } = await supabase
    .from("challenge_participants")
    .select("*, profiles(display_name, trust_score)")
    .eq("challenge_id", dispute.challengeId);
  const { data: escrow } = await supabase.from("escrow_accounts").select("*")
    .eq("challenge_id", dispute.challengeId).maybeSingle();
  const { data: evidence } = await supabase
    .from("dispute_evidence")
    .select("*")
    .eq("dispute_id", disputeId)
    .order("created_at", { ascending: true });
  const timeline = await getChallengeTimeline(dispute.challengeId);
  const chat = await getChatReadOnlyForModerator(
    dispute.challengeId,
    moderatorId,
    isAdmin,
  );
  const { data: auditHistory } = await supabase
    .from("audit_logs")
    .select("*")
    .eq("target_table", "disputes")
    .eq("target_id", disputeId)
    .order("created_at", { ascending: true });

  return {
    dispute,
    challenge,
    participants: participants ?? [],
    escrow,
    evidence: evidence ?? [],
    timeline,
    chat,
    auditHistory: auditHistory ?? [],
  };
}

/** Moderator-scoped chat read -- see file header note on why this can't
 * reuse REALTIME-001's participant-gated getMessages(). */
async function getChatReadOnlyForModerator(
  challengeId: string,
  _moderatorId: string,
  isAdmin: boolean,
) {
  const supabase = getServiceRoleClient();

  if (!isAdmin) {
    const { data: dispute } = await supabase.from("disputes").select("id").eq(
      "challenge_id",
      challengeId,
    ).maybeSingle();
    if (!dispute) {
      throw new AuthorizationError(
        "No dispute exists for this challenge -- chat is not accessible outside a dispute context.",
      );
    }
  }

  const { data, error } = await supabase
    .from("challenge_messages")
    .select("*")
    .eq("challenge_id", challengeId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Failed to fetch chat: ${error.message}`);
  return data ?? [];
}

export async function getEvidenceList(
  disputeId: string,
  moderatorId: string,
  isAdmin: boolean,
) {
  await assertModeratorOnDispute(disputeId, moderatorId, isAdmin);

  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("dispute_evidence")
    .select("*")
    .eq("dispute_id", disputeId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Failed to fetch evidence: ${error.message}`);
  return data ?? [];
}
