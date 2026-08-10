// supabase/functions/_moderator/decisions.ts
//
// SECURITY-CRITICAL FILE: every decision here calls a CHALLENGE-001/
// escrow-transition.ts function that itself calls WALLET-001's
// releaseFromEscrow -- this file never inserts into wallet_ledger,
// wallet_transactions, or updates a challenges.status column directly.
// Verified by grep (see MODERATOR-001-deliverable.md's checklist): zero
// occurrences of "wallet_ledger", "wallet_transactions", or a raw
// "from('challenges').update" in this file.

import { getServiceRoleClient } from "../_shared/database/client.ts";
import { ConflictError, ValidationError } from "../_shared/errors/index.ts";
import { recordAudit } from "../_shared/audit/index.ts";
import { emit } from "../_shared/events/index.ts";
import {
  moderatorResolveDispute,
  moderatorVoidMatch,
} from "../_challenge/escrow-transition.ts";
import { getDisputeOrThrow, updateDispute } from "./repository.ts";
import { assertModeratorOnDispute } from "./cases.ts";

const MIN_RATIONALE_LENGTH = 10;

function assertRationale(rationale: string): void {
  if (rationale.trim().length < MIN_RATIONALE_LENGTH) {
    throw new ValidationError(
      `A rationale of at least ${MIN_RATIONALE_LENGTH} characters is required.`,
    );
  }
}

async function finalizeDisputeDecision(
  disputeId: string,
  resolution: "winner_confirmed" | "opponent_confirmed" | "voided",
  rationale: string,
  moderatorId: string,
): Promise<void> {
  await updateDispute(disputeId, {
    status: "resolved",
    resolution,
    resolution_rationale: rationale,
    decided_at: new Date().toISOString(),
  });

  await recordAudit({
    actorId: moderatorId,
    actorType: "moderator",
    action: "ModeratorDecisionRecorded",
    category: "moderation",
    targetTable: "disputes",
    targetId: disputeId,
    metadata: { resolution, rationale },
  });

  await emit({
    type: "ModeratorDecisionRecorded",
    payload: { disputeId, resolution },
    emittedBy: "moderator-decision",
  });
}

export async function approveWinner(
  disputeId: string,
  moderatorId: string,
  rationale: string,
  isAdmin: boolean,
): Promise<void> {
  assertRationale(rationale);
  await assertModeratorOnDispute(disputeId, moderatorId, isAdmin);
  const dispute = await getDisputeOrThrow(disputeId);
  const supabase = getServiceRoleClient();
  const { data: challenge } = await supabase
    .from("challenges")
    .select("winner_submitted_by")
    .eq("id", dispute.challengeId)
    .single();
  if (!challenge?.winner_submitted_by) {
    throw new ConflictError("No winner was ever submitted for this challenge.");
  }

  await moderatorResolveDispute(
    dispute.challengeId,
    challenge.winner_submitted_by,
    moderatorId,
  );
  await finalizeDisputeDecision(
    disputeId,
    "winner_confirmed",
    rationale,
    moderatorId,
  );
}

export async function approveOpponent(
  disputeId: string,
  moderatorId: string,
  rationale: string,
  isAdmin: boolean,
): Promise<void> {
  assertRationale(rationale);
  await assertModeratorOnDispute(disputeId, moderatorId, isAdmin);
  const dispute = await getDisputeOrThrow(disputeId);
  const supabase = getServiceRoleClient();
  const { data: challenge } = await supabase
    .from("challenges")
    .select("winner_submitted_by, creator_id, opponent_id")
    .eq("id", dispute.challengeId)
    .single();
  if (!challenge?.winner_submitted_by) {
    throw new ConflictError("No winner was ever submitted for this challenge.");
  }

  const actualWinner = challenge.winner_submitted_by === challenge.creator_id
    ? challenge.opponent_id
    : challenge.creator_id;
  await moderatorResolveDispute(dispute.challengeId, actualWinner, moderatorId);
  await finalizeDisputeDecision(
    disputeId,
    "opponent_confirmed",
    rationale,
    moderatorId,
  );
}

export async function dismissInvalidDispute(
  disputeId: string,
  moderatorId: string,
  rationale: string,
  isAdmin: boolean,
): Promise<void> {
  await approveWinner(disputeId, moderatorId, rationale, isAdmin);
}

export async function voidMatch(
  disputeId: string,
  moderatorId: string,
  rationale: string,
  isAdmin: boolean,
): Promise<void> {
  assertRationale(rationale);
  await assertModeratorOnDispute(disputeId, moderatorId, isAdmin);
  const dispute = await getDisputeOrThrow(disputeId);
  await moderatorVoidMatch(dispute.challengeId, moderatorId);
  await finalizeDisputeDecision(disputeId, "voided", rationale, moderatorId);
}

export async function requestMoreEvidence(
  disputeId: string,
  moderatorId: string,
  isAdmin: boolean,
  extensionHours = 24,
): Promise<void> {
  await assertModeratorOnDispute(disputeId, moderatorId, isAdmin);
  const dispute = await getDisputeOrThrow(disputeId);
  const newDeadline = new Date(
    Math.max(Date.now(), new Date(dispute.evidenceDeadlineAt).getTime()) +
      extensionHours * 60 * 60 * 1000,
  );

  await updateDispute(disputeId, {
    evidence_deadline_at: newDeadline.toISOString(),
  });
  await recordAudit({
    actorId: moderatorId,
    actorType: "moderator",
    action: "MoreEvidenceRequested",
    category: "dispute",
    targetTable: "disputes",
    targetId: disputeId,
    metadata: { new_deadline: newDeadline.toISOString() },
  });
}

export async function returnToPlayers(
  disputeId: string,
  moderatorId: string,
  note: string,
  isAdmin: boolean,
): Promise<void> {
  await assertModeratorOnDispute(disputeId, moderatorId, isAdmin);
  await recordAudit({
    actorId: moderatorId,
    actorType: "moderator",
    action: "DisputeReturnedToPlayers",
    category: "dispute",
    targetTable: "disputes",
    targetId: disputeId,
    metadata: { note },
  });
}

/**
 * Reopen Case: only legal while the underlying challenge is STILL in
 * moderator_review. Reopening after completion is out of scope, since the
 * state guard has no completed -> moderator_review edge, and adding one
 * would let a moderator claw back money that already settled -- exactly
 * what "moderators never bypass challenge workflows" exists to prevent.
 */
export async function reopenCase(
  disputeId: string,
  moderatorId: string,
  isAdmin: boolean,
): Promise<void> {
  await assertModeratorOnDispute(disputeId, moderatorId, isAdmin);
  const dispute = await getDisputeOrThrow(disputeId);
  const supabase = getServiceRoleClient();
  const { data: challenge } = await supabase.from("challenges").select("status")
    .eq("id", dispute.challengeId).single();

  if (challenge?.status !== "moderator_review") {
    throw new ConflictError(
      `Cannot reopen dispute ${disputeId}: the underlying challenge has already moved past moderator_review (status: ${challenge?.status}).`,
    );
  }

  await updateDispute(disputeId, {
    status: "under_review",
    resolution: null,
    resolution_rationale: null,
    decided_at: null,
  });
  await recordAudit({
    actorId: moderatorId,
    actorType: "moderator",
    action: "DisputeReopened",
    category: "dispute",
    targetTable: "disputes",
    targetId: disputeId,
  });
}
