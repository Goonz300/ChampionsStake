// supabase/functions/_team/repository.ts

import { getServiceRoleClient } from "../_shared/database/client.ts";
import { NotFoundError } from "../_shared/errors/index.ts";
import type { Team, TeamInvitation, TeamMember, TeamType } from "./types.ts";

function toTeam(row: Record<string, unknown>): Team {
  return {
    id: row.id as string,
    name: row.name as string,
    slug: row.slug as string,
    description: row.description as string | null,
    teamType: row.team_type as TeamType,
    parentOrganizationId: row.parent_organization_id as string | null,
    ownerId: row.owner_id as string,
    avatarUrl: row.avatar_url as string | null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function toMember(row: Record<string, unknown>): TeamMember {
  return {
    id: row.id as string,
    teamId: row.team_id as string,
    userId: row.user_id as string,
    role: row.role as TeamMember["role"],
    joinedAt: row.joined_at as string,
    leftAt: row.left_at as string | null,
  };
}

function toInvitation(row: Record<string, unknown>): TeamInvitation {
  return {
    id: row.id as string,
    teamId: row.team_id as string,
    invitedUserId: row.invited_user_id as string,
    invitedBy: row.invited_by as string,
    status: row.status as TeamInvitation["status"],
    createdAt: row.created_at as string,
    respondedAt: row.responded_at as string | null,
  };
}

export async function getTeamById(teamId: string): Promise<Team> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase.from("teams").select("*").eq(
    "id",
    teamId,
  ).maybeSingle();
  if (error) throw new Error(`Failed to fetch team: ${error.message}`);
  if (!data) throw new NotFoundError(`Team ${teamId} does not exist.`);
  return toTeam(data);
}

export async function getTeamBySlug(slug: string): Promise<Team | null> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase.from("teams").select("*").eq(
    "slug",
    slug,
  ).maybeSingle();
  if (error) throw new Error(`Failed to fetch team: ${error.message}`);
  return data ? toTeam(data) : null;
}

export async function listActiveMembers(teamId: string): Promise<TeamMember[]> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("team_members")
    .select("*")
    .eq("team_id", teamId)
    .is("left_at", null)
    .order("joined_at", { ascending: true });
  if (error) throw new Error(`Failed to list team members: ${error.message}`);
  return (data ?? []).map(toMember);
}

export async function getActiveMembership(
  teamId: string,
  userId: string,
): Promise<TeamMember | null> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("team_members")
    .select("*")
    .eq("team_id", teamId)
    .eq("user_id", userId)
    .is("left_at", null)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to fetch membership: ${error.message}`);
  }
  return data ? toMember(data) : null;
}

export async function getInvitationById(
  invitationId: string,
): Promise<TeamInvitation> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("team_invitations")
    .select("*")
    .eq("id", invitationId)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to fetch invitation: ${error.message}`);
  }
  if (!data) {
    throw new NotFoundError(`Invitation ${invitationId} does not exist.`);
  }
  return toInvitation(data);
}

export async function listInvitationsForUser(
  userId: string,
): Promise<TeamInvitation[]> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("team_invitations")
    .select("*")
    .eq("invited_user_id", userId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) {
    throw new Error(`Failed to list invitations: ${error.message}`);
  }
  return (data ?? []).map(toInvitation);
}

export { toInvitation, toMember, toTeam };
