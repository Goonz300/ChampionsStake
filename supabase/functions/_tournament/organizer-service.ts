// supabase/functions/_tournament/organizer-service.ts
//
// Phase 8 (TOURNAMENT-007): Organizer Platform -- templates, recurring
// spawn, invitations, dashboard. Reuses createTournament (workflow.ts)
// directly for the actual tournament row rather than duplicating that
// insert logic, and Phase 7 M3's computeOrganizerReputation for the
// dashboard's quality signal rather than a second reputation mechanism.

import { getServiceRoleClient } from "../_shared/database/client.ts";
import { recordAudit } from "../_shared/audit/index.ts";
import { emit } from "../_shared/events/index.ts";
import {
  AuthorizationError,
  ConflictError,
  ValidationError,
} from "../_shared/errors/index.ts";
import { computeOrganizerReputation } from "../_ai/reputation-engine.ts";
import { createTournament } from "./workflow.ts";

const supabase = getServiceRoleClient();

export interface TournamentTemplateInput {
  name: string;
  gameId: string;
  format: "single_elim" | "double_elim" | "round_robin" | "swiss";
  entryFeeCents: number;
  payoutStructure: Record<string, number>;
  visibility: "public" | "private" | "invite_only";
  isRecurring: boolean;
  recurrenceRule: string | null;
  sponsorName: string | null;
  sponsorLogoUrl: string | null;
}

export async function createTemplate(
  createdBy: string,
  input: TournamentTemplateInput,
): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from("tournament_templates")
    .insert({
      name: input.name,
      created_by: createdBy,
      game_id: input.gameId,
      format: input.format,
      entry_fee_cents: input.entryFeeCents,
      payout_structure: input.payoutStructure,
      visibility: input.visibility,
      is_recurring: input.isRecurring,
      recurrence_rule: input.recurrenceRule,
      sponsor_name: input.sponsorName,
      sponsor_logo_url: input.sponsorLogoUrl,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`Failed to create tournament template: ${error?.message}`);
  }

  await recordAudit({
    actorId: createdBy,
    actorType: "user",
    action: "TournamentTemplateCreated",
    category: "tournament",
    targetTable: "tournament_templates",
    targetId: data.id,
    metadata: { name: input.name },
  });

  return { id: data.id };
}

/**
 * Spawns a new draft tournament from a template -- this IS "Recurring
 * tournaments" in concrete form: an organizer (or, for a genuinely
 * automatic cadence, a future scheduled job reading recurrence_rule) calls
 * this repeatedly to produce each occurrence, rather than a separate
 * "recurring tournament" entity type. Delegates to createTournament
 * (workflow.ts) for the actual insert -- never duplicates that logic.
 */
export async function spawnFromTemplate(
  actorId: string,
  templateId: string,
  overrides: {
    registrationOpensAt?: string;
    registrationClosesAt?: string;
    checkInOpensAt?: string;
    startsAt?: string;
  } = {},
): Promise<{ id: string }> {
  const { data: template, error } = await supabase
    .from("tournament_templates")
    .select("*")
    .eq("id", templateId)
    .maybeSingle();
  if (error) throw new Error(`Failed to fetch template: ${error.message}`);
  if (!template) {
    throw new ValidationError(`Template ${templateId} does not exist.`);
  }
  if (template.created_by !== actorId) {
    throw new AuthorizationError(
      "Only the template's creator can spawn from it.",
    );
  }

  const result = await createTournament(actorId, {
    gameId: template.game_id,
    name: template.name,
    format: template.format,
    entryFeeCents: template.entry_fee_cents,
    registrationOpensAt: overrides.registrationOpensAt,
    registrationClosesAt: overrides.registrationClosesAt,
    checkInOpensAt: overrides.checkInOpensAt,
    startsAt: overrides.startsAt,
    visibility: template.visibility,
    isRecurring: template.is_recurring,
    recurrenceRule: template.recurrence_rule,
    templateId: template.id,
    sponsorName: template.sponsor_name,
    sponsorLogoUrl: template.sponsor_logo_url,
  });

  await supabase
    .from("tournaments")
    .update({ payout_structure: template.payout_structure })
    .eq("id", result.id);

  return result;
}

export async function inviteToTournament(
  tournamentId: string,
  inviterId: string,
  invitedUserId: string,
): Promise<{ id: string }> {
  const { data: tournament } = await supabase
    .from("tournaments")
    .select("created_by")
    .eq("id", tournamentId)
    .maybeSingle();
  if (!tournament) {
    throw new ValidationError(`Tournament ${tournamentId} does not exist.`);
  }
  if (tournament.created_by !== inviterId) {
    throw new AuthorizationError(
      "Only the tournament's organizer can send invitations.",
    );
  }

  const { data, error } = await supabase
    .from("tournament_invitations")
    .insert({
      tournament_id: tournamentId,
      invited_user_id: invitedUserId,
      invited_by: inviterId,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") {
      throw new ConflictError(
        "This user already has a pending invitation to this tournament.",
      );
    }
    throw new Error(`Failed to create invitation: ${error.message}`);
  }

  await emit({
    type: "TournamentInvitationSent",
    payload: { tournamentId, invitedUserId, invitedBy: inviterId },
    emittedBy: "organizer-service",
  });

  return { id: data.id };
}

export async function respondToTournamentInvitation(
  invitationId: string,
  userId: string,
  accept: boolean,
): Promise<void> {
  const { data: claimed, error } = await supabase
    .from("tournament_invitations")
    .update({
      status: accept ? "accepted" : "declined",
      responded_at: new Date().toISOString(),
    })
    .eq("id", invitationId)
    .eq("invited_user_id", userId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to respond to invitation: ${error.message}`);
  }
  if (!claimed) {
    throw new ConflictError(
      "This invitation is no longer pending, or is not addressed to you.",
    );
  }

  await recordAudit({
    actorId: userId,
    actorType: "user",
    action: accept
      ? "TournamentInvitationAccepted"
      : "TournamentInvitationDeclined",
    category: "tournament",
    targetTable: "tournament_invitations",
    targetId: invitationId,
    metadata: {},
  });
}

export interface OrganizerDashboard {
  reputationScore: number;
  tournamentCounts: Record<string, number>;
  templateCount: number;
}

/** Reuses Phase 7 M3's computeOrganizerReputation directly -- the
 * "quality" signal an organizer dashboard needs already exists, not
 * duplicated here. */
export async function getOrganizerDashboard(
  organizerId: string,
): Promise<OrganizerDashboard> {
  const [
    { score: reputationScore },
    { data: tournaments },
    { count: templateCount },
  ] = await Promise.all([
    computeOrganizerReputation(organizerId),
    supabase.from("tournaments").select("status").eq("created_by", organizerId),
    supabase
      .from("tournament_templates")
      .select("id", { count: "exact", head: true })
      .eq("created_by", organizerId),
  ]);

  const tournamentCounts: Record<string, number> = {};
  for (const t of tournaments ?? []) {
    const status = t.status as string;
    tournamentCounts[status] = (tournamentCounts[status] ?? 0) + 1;
  }

  return {
    reputationScore,
    tournamentCounts,
    templateCount: templateCount ?? 0,
  };
}
