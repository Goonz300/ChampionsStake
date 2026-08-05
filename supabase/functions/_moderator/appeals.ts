// supabase/functions/_moderator/appeals.ts
// Reuses the appeal_filed_at/appeal_deadline_at/appeal_decided_at/
// appeal_decided_by columns already on disputes (DB-001) -- no new schema.

import { getServiceRoleClient } from "../_shared/database/client.ts";
import { AuthorizationError, ConflictError } from "../_shared/errors/index.ts";
import { recordAudit } from "../_shared/audit/index.ts";
import { emit } from "../_shared/events/index.ts";
import { getDisputeOrThrow, updateDispute } from "./repository.ts";

const APPEAL_WINDOW_HOURS = 72; // Business Rules §9/§16

export async function fileAppeal(
  disputeId: string,
  filedBy: string,
): Promise<void> {
  const dispute = await getDisputeOrThrow(disputeId);

  if (dispute.status !== "resolved") {
    throw new ConflictError(
      `Dispute ${disputeId} has no decision to appeal (status: ${dispute.status}).`,
    );
  }
  if (dispute.appealFiledAt) {
    throw new ConflictError(
      "One appeal has already been filed for this dispute (Business Rules §9: one per dispute).",
    );
  }
  if (
    !dispute.decidedAt ||
    Date.now() - new Date(dispute.decidedAt).getTime() >
      APPEAL_WINDOW_HOURS * 60 * 60 * 1000
  ) {
    throw new ConflictError(
      `The ${APPEAL_WINDOW_HOURS}-hour appeal window has passed.`,
    );
  }

  const now = new Date();
  await updateDispute(disputeId, {
    status: "appealed",
    appeal_filed_at: now.toISOString(),
    appeal_deadline_at: new Date(
      now.getTime() + APPEAL_WINDOW_HOURS * 60 * 60 * 1000,
    ).toISOString(),
  });

  await recordAudit({
    actorId: filedBy,
    actorType: "user",
    action: "AppealFiled",
    category: "dispute",
    targetTable: "disputes",
    targetId: disputeId,
  });

  await emit({
    type: "DisputeOpened",
    payload: { disputeId, event: "AppealFiled" },
    emittedBy: "moderator-appeal",
  });
}

/** Assigns a senior moderator/administrator to review the appeal -- reuses
 * the same assigned_moderator_id column (now representing the appeal
 * reviewer, not the original moderator). */
export async function assignAppealReviewer(
  disputeId: string,
  reviewerId: string,
  actorId: string,
): Promise<void> {
  const supabase = getServiceRoleClient();
  const { data: reviewer } = await supabase.from("profiles").select(
    "role, status",
  ).eq("id", reviewerId).maybeSingle();
  if (
    !reviewer || reviewer.role !== "administrator" ||
    reviewer.status !== "active"
  ) {
    throw new AuthorizationError(
      "Appeal reviewers must be an active administrator (Business Rules §9: senior moderator/admin).",
    );
  }

  await updateDispute(disputeId, { assigned_moderator_id: reviewerId });
  await recordAudit({
    actorId,
    actorType: "administrator",
    action: "AppealReviewerAssigned",
    category: "dispute",
    targetTable: "disputes",
    targetId: disputeId,
    metadata: { reviewer_id: reviewerId },
  });
}

/**
 * Records the final appeal verdict and closes the case.
 *
 * HONEST SCOPE NOTE: by the time an appeal is filed, the original decision
 * has ALREADY moved funds (moderatorResolveDispute/moderatorVoidMatch ran
 * at the initial decision). This function does NOT re-trigger fund
 * movement, because the challenge state guard has no path back from
 * completed/cancelled into moderator_review (the same reasoning
 * decisions.ts's reopenCase documents). If an appeal verdict genuinely
 * requires reversing already-settled funds, that is a deliberate
 * administrative action via ADMIN-001's existing four-eyes wallet-
 * adjustment flow -- a human decision with its own accountability trail,
 * not something automatically triggered by this function. This function's
 * job is narrowly to record the verdict and close the dispute record.
 */
export async function decideAppeal(
  disputeId: string,
  resolution: "winner_confirmed" | "opponent_confirmed" | "voided",
  rationale: string,
  reviewerId: string,
): Promise<void> {
  const dispute = await getDisputeOrThrow(disputeId);
  if (dispute.status !== "appealed") {
    throw new ConflictError(
      `Dispute ${disputeId} is not currently under appeal (status: ${dispute.status}).`,
    );
  }

  await updateDispute(disputeId, {
    status: "closed",
    appeal_decided_at: new Date().toISOString(),
    appeal_decided_by: reviewerId,
  });

  await recordAudit({
    actorId: reviewerId,
    actorType: "administrator",
    action: "AppealDecided",
    category: "dispute",
    targetTable: "disputes",
    targetId: disputeId,
    metadata: {
      resolution,
      rationale,
      note:
        "Verdict recorded; any fund reversal (if the verdict differs from the original decision) requires a separate ADMIN-001 wallet adjustment.",
    },
  });

  await emit({
    type: "ModeratorDecisionRecorded",
    payload: { disputeId, event: "AppealDecided", resolution },
    emittedBy: "moderator-appeal",
  });
}
