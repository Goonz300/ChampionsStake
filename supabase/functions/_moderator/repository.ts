// supabase/functions/_moderator/repository.ts

import { getServiceRoleClient } from "../_shared/database/client.ts";
import { NotFoundError } from "../_shared/errors/index.ts";
import type { Dispute } from "./types.ts";

function toDispute(row: Record<string, unknown>): Dispute {
  return {
    id: row.id as string,
    challengeId: row.challenge_id as string,
    openedBy: row.opened_by as string,
    reason: row.reason as string,
    status: row.status as Dispute["status"],
    priority: row.priority as Dispute["priority"],
    assignedModeratorId: row.assigned_moderator_id as string | null,
    resolution: row.resolution as Dispute["resolution"],
    resolutionRationale: row.resolution_rationale as string | null,
    evidenceDeadlineAt: row.evidence_deadline_at as string,
    decidedAt: row.decided_at as string | null,
    appealFiledAt: row.appeal_filed_at as string | null,
    appealDeadlineAt: row.appeal_deadline_at as string | null,
    appealDecidedAt: row.appeal_decided_at as string | null,
    appealDecidedBy: row.appeal_decided_by as string | null,
  };
}

export async function getDisputeOrThrow(disputeId: string): Promise<Dispute> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase.from("disputes").select("*").eq(
    "id",
    disputeId,
  ).maybeSingle();
  if (error) {
    throw new Error(`Failed to fetch dispute ${disputeId}: ${error.message}`);
  }
  if (!data) throw new NotFoundError(`Dispute ${disputeId} does not exist.`);
  return toDispute(data);
}

export async function getQueue(priorityOrder = true) {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase.from("v_moderator_queue").select("*");
  if (error) {
    throw new Error(`Failed to fetch moderator queue: ${error.message}`);
  }
  return priorityOrder
    ? data ?? []
    : [...(data ?? [])].sort((a, b) =>
      a.created_at.localeCompare(b.created_at)
    );
}

export async function updateDispute(
  disputeId: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const supabase = getServiceRoleClient();
  const { error } = await supabase.from("disputes").update(fields).eq(
    "id",
    disputeId,
  );
  if (error) {
    throw new Error(`Failed to update dispute ${disputeId}: ${error.message}`);
  }
}

/** Mirrors DB-002's is_dispute_participant(uuid) SQL function via the same
 * join it uses, since that function reads auth.uid() internally and can't
 * be called meaningfully from a service-role context where there is no
 * "current user" session -- this is the same query shape, not new
 * business logic, just usable with an explicit userId parameter. */
export async function isDisputeParticipant(
  disputeId: string,
  userId: string,
): Promise<boolean> {
  const supabase = getServiceRoleClient();
  const { data: dispute } = await supabase.from("disputes").select(
    "challenge_id",
  ).eq("id", disputeId).maybeSingle();
  if (!dispute) return false;

  const { data } = await supabase
    .from("challenge_participants")
    .select("user_id")
    .eq("challenge_id", dispute.challenge_id)
    .eq("user_id", userId)
    .maybeSingle();

  return Boolean(data);
}
