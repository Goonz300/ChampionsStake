// supabase/functions/_team/service.ts
//
// Phase 8 (TOURNAMENT-003): business logic for the Team Platform. Reuses
// existing shared infrastructure throughout -- recordAudit, emit (domain
// events -> the existing notification pipeline), withTransaction for the
// one genuinely multi-row-atomic operation (captain transfer). No new
// middleware, no new auth/authz mechanism: team-scoped permissions
// (owner/captain-only actions) are plain application-code checks against
// team_members.role, the same way this codebase already checks
// dispute.assigned_moderator_id or challenge participancy.

import { getServiceRoleClient } from "../_shared/database/client.ts";
import { withTransaction } from "../_shared/transactions/index.ts";
import { recordAudit } from "../_shared/audit/index.ts";
import { emit } from "../_shared/events/index.ts";
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../_shared/errors/index.ts";
import {
  getActiveMembership,
  getInvitationById,
  getTeamById,
  getTeamBySlug,
  listActiveMembers,
  toTeam,
} from "./repository.ts";
import { slugify } from "./slug.ts";
import type { Team, TeamMember, TeamType } from "./types.ts";

const supabase = getServiceRoleClient();

async function requireActiveMembership(
  teamId: string,
  userId: string,
): Promise<TeamMember> {
  const membership = await getActiveMembership(teamId, userId);
  if (!membership) {
    throw new AuthorizationError("You are not a member of this team.");
  }
  return membership;
}

async function requireOwnerOrCaptain(
  teamId: string,
  userId: string,
): Promise<TeamMember> {
  const membership = await requireActiveMembership(teamId, userId);
  if (membership.role !== "owner" && membership.role !== "captain") {
    throw new AuthorizationError(
      "Only the team owner or captain can perform this action.",
    );
  }
  return membership;
}

export async function createTeam(
  ownerId: string,
  name: string,
  teamType: TeamType,
  description: string | null,
  parentOrganizationId: string | null,
): Promise<Team> {
  const baseSlug = slugify(name);
  if (!baseSlug) {
    throw new ValidationError(
      "Team name must contain at least one letter or number.",
    );
  }

  if (parentOrganizationId) {
    const parent = await getTeamById(parentOrganizationId);
    if (parent.teamType !== "organization") {
      throw new ValidationError(
        "parentOrganizationId must reference a team with teamType 'organization'.",
      );
    }
  }

  // Slug collisions are handled the same way Phase 6/7 handled a race on a
  // unique index elsewhere in this codebase (23505 -> re-derive, don't
  // fail the whole request for a cosmetic collision): append a short
  // numeric suffix and retry a bounded number of times.
  let slug = baseSlug;
  let attempt = 0;
  let team: Record<string, unknown> | null = null;
  let lastError: { code?: string; message: string } | null = null;

  while (attempt < 5 && !team) {
    const { data, error } = await supabase
      .from("teams")
      .insert({
        name,
        slug,
        description,
        team_type: teamType,
        parent_organization_id: parentOrganizationId,
        owner_id: ownerId,
      })
      .select("*")
      .single();

    if (data) {
      team = data;
      break;
    }
    lastError = error;
    if (error?.code !== "23505") break;
    attempt += 1;
    slug = `${baseSlug}-${attempt}`;
  }

  if (!team) {
    throw new Error(`Failed to create team: ${lastError?.message}`);
  }

  await supabase.from("team_members").insert({
    team_id: team.id,
    user_id: ownerId,
    role: "owner",
  });

  await recordAudit({
    actorId: ownerId,
    actorType: "user",
    action: "TeamCreated",
    category: "team",
    targetTable: "teams",
    targetId: team.id as string,
    metadata: { name, teamType },
  });

  return toTeam(team);
}

export async function inviteMember(
  teamId: string,
  inviterId: string,
  invitedUserId: string,
): Promise<{ id: string }> {
  await requireOwnerOrCaptain(teamId, inviterId);

  const existingMembership = await getActiveMembership(teamId, invitedUserId);
  if (existingMembership) {
    throw new ConflictError("This user is already a member of the team.");
  }

  const { data, error } = await supabase
    .from("team_invitations")
    .insert({
      team_id: teamId,
      invited_user_id: invitedUserId,
      invited_by: inviterId,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new ConflictError(
        "This user already has a pending invitation to this team.",
      );
    }
    throw new Error(`Failed to create invitation: ${error.message}`);
  }

  await recordAudit({
    actorId: inviterId,
    actorType: "user",
    action: "TeamInvitationSent",
    category: "team",
    targetTable: "team_invitations",
    targetId: data.id,
    metadata: { teamId, invitedUserId },
  });

  await emit({
    type: "TeamInvitationSent",
    payload: { teamId, invitedUserId, invitedBy: inviterId },
    emittedBy: "team-service",
  });

  return { id: data.id };
}

export async function respondToInvitation(
  invitationId: string,
  userId: string,
  accept: boolean,
): Promise<void> {
  // Atomic claim (established idempotency/race pattern in this codebase --
  // _payment/withdrawal-service.ts's approveHeldWithdrawal/rejectHeldWithdrawal
  // use the exact same shape): only a genuinely-pending invitation the
  // caller owns can transition, and only once.
  const { data: claimed, error } = await supabase
    .from("team_invitations")
    .update({
      status: accept ? "accepted" : "declined",
      responded_at: new Date().toISOString(),
    })
    .eq("id", invitationId)
    .eq("invited_user_id", userId)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to respond to invitation: ${error.message}`);
  }
  if (!claimed) {
    const invitation = await getInvitationById(invitationId);
    if (invitation.invitedUserId !== userId) {
      throw new AuthorizationError("This invitation is not addressed to you.");
    }
    throw new ConflictError("This invitation is no longer pending.");
  }

  if (accept) {
    const { error: memberError } = await supabase.from("team_members").insert({
      team_id: claimed.team_id,
      user_id: userId,
      role: "member",
    });
    if (memberError && memberError.code !== "23505") {
      throw new Error(`Failed to add team member: ${memberError.message}`);
    }
  }

  await recordAudit({
    actorId: userId,
    actorType: "user",
    action: accept ? "TeamInvitationAccepted" : "TeamInvitationDeclined",
    category: "team",
    targetTable: "team_invitations",
    targetId: invitationId,
    metadata: { teamId: claimed.team_id },
  });
}

export async function revokeInvitation(
  invitationId: string,
  actorId: string,
): Promise<void> {
  const invitation = await getInvitationById(invitationId);
  await requireOwnerOrCaptain(invitation.teamId, actorId);

  const { error } = await supabase
    .from("team_invitations")
    .update({ status: "revoked", responded_at: new Date().toISOString() })
    .eq("id", invitationId)
    .eq("status", "pending");
  if (error) throw new Error(`Failed to revoke invitation: ${error.message}`);

  await recordAudit({
    actorId,
    actorType: "user",
    action: "TeamInvitationRevoked",
    category: "team",
    targetTable: "team_invitations",
    targetId: invitationId,
    metadata: { teamId: invitation.teamId },
  });
}

export async function leaveTeam(teamId: string, userId: string): Promise<void> {
  const membership = await requireActiveMembership(teamId, userId);
  if (membership.role === "owner") {
    throw new ConflictError(
      "The team owner cannot leave -- transfer ownership first.",
    );
  }

  const { error } = await supabase
    .from("team_members")
    .update({ left_at: new Date().toISOString() })
    .eq("id", membership.id);
  if (error) throw new Error(`Failed to leave team: ${error.message}`);

  await recordAudit({
    actorId: userId,
    actorType: "user",
    action: "TeamMemberLeft",
    category: "team",
    targetTable: "team_members",
    targetId: membership.id,
    metadata: { teamId },
  });
}

export async function removeMember(
  teamId: string,
  actorId: string,
  targetUserId: string,
): Promise<void> {
  const actorMembership = await requireOwnerOrCaptain(teamId, actorId);
  const targetMembership = await requireActiveMembership(teamId, targetUserId);

  if (targetMembership.role === "owner") {
    throw new ConflictError("The team owner cannot be removed.");
  }
  if (targetMembership.role === "captain" && actorMembership.role !== "owner") {
    throw new AuthorizationError("Only the owner can remove a captain.");
  }

  const { error } = await supabase
    .from("team_members")
    .update({ left_at: new Date().toISOString() })
    .eq("id", targetMembership.id);
  if (error) throw new Error(`Failed to remove member: ${error.message}`);

  await recordAudit({
    actorId,
    actorType: "user",
    action: "TeamMemberRemoved",
    category: "team",
    targetTable: "team_members",
    targetId: targetMembership.id,
    metadata: { teamId, targetUserId },
  });
}

/**
 * Captain transfer: the owner promotes a member to captain, or transfers
 * ownership itself to another member. Wrapped in withTransaction (the same
 * primitive the wallet ledger uses) because leaving the team with zero
 * owners, even briefly between two separate UPDATE statements, is a real
 * correctness bug this function must not risk.
 */
export async function transferOwnership(
  teamId: string,
  currentOwnerId: string,
  newOwnerId: string,
): Promise<void> {
  if (currentOwnerId === newOwnerId) {
    throw new ValidationError("Cannot transfer ownership to yourself.");
  }

  const newOwnerMembership = await getActiveMembership(teamId, newOwnerId);
  if (!newOwnerMembership) {
    throw new ValidationError(
      "The new owner must already be an active member of the team.",
    );
  }

  await withTransaction(async (sql) => {
    const ownerRows = await sql`
      select id from team_members
      where team_id = ${teamId} and user_id = ${currentOwnerId} and left_at is null
      for update
    `;
    if (ownerRows.length === 0) {
      throw new AuthorizationError(
        "You are not the current owner of this team.",
      );
    }

    await sql`
      update team_members set role = 'captain'
      where team_id = ${teamId} and user_id = ${currentOwnerId} and left_at is null
    `;
    await sql`
      update team_members set role = 'owner'
      where team_id = ${teamId} and user_id = ${newOwnerId} and left_at is null
    `;
    await sql`
      update teams set owner_id = ${newOwnerId}, updated_at = now()
      where id = ${teamId}
    `;
  });

  await recordAudit({
    actorId: currentOwnerId,
    actorType: "user",
    action: "TeamOwnershipTransferred",
    category: "team",
    targetTable: "teams",
    targetId: teamId,
    metadata: { newOwnerId },
  });

  await emit({
    type: "TeamOwnershipTransferred",
    payload: { teamId, previousOwnerId: currentOwnerId, newOwnerId },
    emittedBy: "team-service",
  });
}

export async function promoteToCaptain(
  teamId: string,
  actorId: string,
  targetUserId: string,
): Promise<void> {
  const actorMembership = await requireActiveMembership(teamId, actorId);
  if (actorMembership.role !== "owner") {
    throw new AuthorizationError("Only the owner can promote a captain.");
  }

  const targetMembership = await requireActiveMembership(teamId, targetUserId);
  if (targetMembership.role !== "member") {
    throw new ConflictError("This user already holds a leadership role.");
  }

  const { error } = await supabase
    .from("team_members")
    .update({ role: "captain" })
    .eq("id", targetMembership.id);
  if (error) throw new Error(`Failed to promote member: ${error.message}`);

  await recordAudit({
    actorId,
    actorType: "user",
    action: "TeamCaptainPromoted",
    category: "team",
    targetTable: "team_members",
    targetId: targetMembership.id,
    metadata: { teamId, targetUserId },
  });
}

export interface TeamStatistics {
  memberCount: number;
  tournamentsEntered: number;
  tournamentsWon: number;
}

/** Reuses tournament_registrations.team_id (migration 0094) directly --
 * no separate team-statistics table, computed on read like every other
 * *Statistics function in this codebase (_admin/analytics.ts, etc.). */
export async function getTeamStatistics(
  teamId: string,
): Promise<TeamStatistics> {
  const members = await listActiveMembers(teamId);

  const { data: registrations } = await supabase
    .from("tournament_registrations")
    .select("tournament_id, tournaments!inner(status)")
    .eq("team_id", teamId);

  const tournamentIds = new Set(
    (registrations ?? []).map((r) => r.tournament_id as string),
  );

  return {
    memberCount: members.length,
    tournamentsEntered: tournamentIds.size,
    // A precise "won as a team" count needs tournament-outcome data keyed
    // by team, not just prize transactions (which are keyed by wallet/user)
    // -- left as 0 pending that linkage rather than an approximate/
    // misleading number. See docs/TEAM_PLATFORM_DESIGN.md.
    tournamentsWon: 0,
  };
}

export async function getTeamBySlugOrThrow(slug: string): Promise<Team> {
  const team = await getTeamBySlug(slug);
  if (!team) throw new NotFoundError(`No team found with slug ${slug}.`);
  return team;
}
