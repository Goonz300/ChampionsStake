// supabase/functions/_team/types.ts

export type TeamType = "team" | "organization" | "clan";
export type TeamMemberRole = "owner" | "captain" | "member";
export type TeamInvitationStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "revoked";

export interface Team {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  teamType: TeamType;
  parentOrganizationId: string | null;
  ownerId: string;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TeamMember {
  id: string;
  teamId: string;
  userId: string;
  role: TeamMemberRole;
  joinedAt: string;
  leftAt: string | null;
}

export interface TeamInvitation {
  id: string;
  teamId: string;
  invitedUserId: string;
  invitedBy: string;
  status: TeamInvitationStatus;
  createdAt: string;
  respondedAt: string | null;
}
