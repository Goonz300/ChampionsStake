// supabase/functions/_moderator/queue.ts

import { getServiceRoleClient } from "../_shared/database/client.ts";
import { AuthorizationError, ConflictError } from "../_shared/errors/index.ts";
import { recordAudit } from "../_shared/audit/index.ts";
import { emit } from "../_shared/events/index.ts";
import { getDisputeOrThrow } from "./repository.ts";

/**
 * Automatic assignment: workload-based -- assigns to whichever active
 * moderator currently has the fewest open/under_review disputes. Simple
 * and fair without inventing a scoring model (this phase's "orchestrate
 * existing services only" mandate argues against a new prioritization
 * engine beyond the priority column already added in migration 0058).
 */
export async function autoAssign(disputeId: string): Promise<string> {
  const supabase = getServiceRoleClient();

  const dispute = await getDisputeOrThrow(disputeId);
  if (dispute.assignedModeratorId) {
    throw new ConflictError(`Dispute ${disputeId} is already assigned.`);
  }

  const { data: moderators } = await supabase.from("profiles").select("id").eq(
    "role",
    "moderator",
  ).eq("status", "active");
  if (!moderators || moderators.length === 0) {
    throw new ConflictError("No active moderators available for assignment.");
  }

  const { data: openCounts } = await supabase
    .from("disputes")
    .select("assigned_moderator_id")
    .in("status", ["open", "under_review"])
    .not("assigned_moderator_id", "is", null);

  const workload = new Map<string, number>(moderators.map((m) => [m.id, 0]));
  for (const row of openCounts ?? []) {
    if (row.assigned_moderator_id) {
      workload.set(
        row.assigned_moderator_id,
        (workload.get(row.assigned_moderator_id) ?? 0) + 1,
      );
    }
  }

  const chosen = [...workload.entries()].sort((a, b) => a[1] - b[1])[0][0];
  await assignDispute(disputeId, chosen, null);
  return chosen;
}

/** Manual assignment / reassignment. actorId is null for the automatic path above. */
export async function assignDispute(
  disputeId: string,
  moderatorId: string,
  actorId: string | null,
): Promise<void> {
  const supabase = getServiceRoleClient();

  const { data: moderator } = await supabase.from("profiles").select(
    "role, status",
  ).eq("id", moderatorId).maybeSingle();
  if (
    !moderator ||
    (moderator.role !== "moderator" && moderator.role !== "administrator") ||
    moderator.status !== "active"
  ) {
    throw new AuthorizationError(
      `User ${moderatorId} is not an active moderator or administrator.`,
    );
  }

  const { error } = await supabase.from("disputes").update({
    assigned_moderator_id: moderatorId,
  }).eq("id", disputeId);
  if (error) throw new Error(`Failed to assign dispute: ${error.message}`);

  await recordAudit({
    actorId,
    actorType: actorId ? "moderator" : "system",
    action: "ModeratorAssigned",
    category: "dispute",
    targetTable: "disputes",
    targetId: disputeId,
    metadata: { moderator_id: moderatorId },
  });

  await emit({
    type: "DisputeOpened",
    payload: { disputeId, event: "ModeratorAssigned", moderatorId },
    emittedBy: "moderator-assign",
  });
}

export async function claimDispute(
  disputeId: string,
  moderatorId: string,
): Promise<void> {
  const dispute = await getDisputeOrThrow(disputeId);
  if (dispute.assignedModeratorId) {
    throw new ConflictError(
      `Dispute ${disputeId} is already assigned to another moderator.`,
    );
  }
  await assignDispute(disputeId, moderatorId, moderatorId);
}

export async function setPriority(
  disputeId: string,
  priority: "low" | "normal" | "high" | "urgent",
  actorId: string,
): Promise<void> {
  const supabase = getServiceRoleClient();
  const { error } = await supabase.from("disputes").update({ priority }).eq(
    "id",
    disputeId,
  );
  if (error) throw new Error(`Failed to set priority: ${error.message}`);

  await recordAudit({
    actorId,
    actorType: "moderator",
    action: "DisputePriorityChanged",
    category: "dispute",
    targetTable: "disputes",
    targetId: disputeId,
    metadata: { priority },
  });
}

/** Escalation: reassigns to an administrator and bumps priority to urgent
 * -- reuses assignDispute/setPriority rather than introducing a separate
 * escalation state machine. */
export async function escalateDispute(
  disputeId: string,
  adminId: string,
  moderatorId: string,
  reason: string,
): Promise<void> {
  const supabase = getServiceRoleClient();
  const { data: admin } = await supabase.from("profiles").select("role, status")
    .eq("id", adminId).maybeSingle();
  if (!admin || admin.role !== "administrator" || admin.status !== "active") {
    throw new AuthorizationError(
      `User ${adminId} is not an active administrator.`,
    );
  }

  await assignDispute(disputeId, adminId, moderatorId);
  await setPriority(disputeId, "urgent", moderatorId);

  await recordAudit({
    actorId: moderatorId,
    actorType: "moderator",
    action: "DisputeEscalated",
    category: "dispute",
    targetTable: "disputes",
    targetId: disputeId,
    metadata: { escalated_to: adminId, reason },
  });

  await emit({
    type: "DisputeOpened",
    payload: { disputeId, event: "DisputeEscalated", adminId },
    emittedBy: "moderator-escalate",
  });
}
