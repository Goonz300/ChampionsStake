// supabase/functions/tournament-organize/index.ts
// Organizer-facing write/dashboard actions (Phase 8 TOURNAMENT-007).
// Tournament creation itself stays on tournament-create -- this function
// is everything ELSE an organizer does: templates, recurring spawn,
// invitations, dashboard.

import { z } from "zod";
import {
  type EdgeContext,
  withEdgeFunction,
} from "../_shared/middleware/index.ts";
import { requireOrganizer } from "../_shared/permissions/index.ts";
import {
  parseJsonBody,
  validateBody,
  validateQuery,
} from "../_shared/validation/validate.ts";
import { successResponse } from "../_shared/response/index.ts";
import { ValidationError } from "../_shared/errors/index.ts";
import {
  createTemplate,
  getOrganizerDashboard,
  inviteToTournament,
  respondToTournamentInvitation,
  spawnFromTemplate,
} from "../_tournament/organizer-service.ts";
import {
  getTournamentDropOff,
  getTournamentEcosystemHealth,
  getTournamentParticipation,
  getTournamentQuality,
  getTournamentRevenue,
} from "../_tournament/analytics.ts";
import {
  autoRescheduleIfUnderfilled,
  checkOrganizerScheduleConflict,
  getSchedulingAdherence,
} from "../_tournament/scheduling.ts";
import { getServiceRoleClient } from "../_shared/database/client.ts";
import { AuthorizationError } from "../_shared/errors/index.ts";

const getQuerySchema = z.object({
  view: z.enum([
    "dashboard",
    "participation",
    "revenue",
    "drop_off",
    "quality",
    "ecosystem_health",
    "scheduling_adherence",
    "schedule_conflict",
  ]).default("dashboard"),
  tournamentId: z.string().uuid().optional(),
  gameId: z.string().uuid().optional(),
  registrationOpensAt: z.string().datetime({ offset: true }).optional(),
  startsAt: z.string().datetime({ offset: true }).optional(),
});

/** Financial/participation analytics for a specific tournament are
 * organizer(-of-that-tournament)-or-admin only -- revenue in particular is
 * not public data the way the bracket/standings tournament-browse serves
 * are. */
async function requireTournamentOwnerOrAdmin(
  ctx: EdgeContext,
  tournamentId: string,
): Promise<void> {
  if (ctx.profile!.role === "administrator") return;
  const supabase = getServiceRoleClient();
  const { data: tournament } = await supabase
    .from("tournaments")
    .select("created_by")
    .eq("id", tournamentId)
    .maybeSingle();
  if (!tournament || tournament.created_by !== ctx.user!.id) {
    throw new AuthorizationError(
      "Only this tournament's organizer or an administrator can view its analytics.",
    );
  }
}

const postBodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create_template"),
    name: z.string().min(2).max(100),
    gameId: z.string().uuid(),
    format: z.enum(["single_elim", "double_elim", "round_robin", "swiss"]),
    entryFeeCents: z.number().int().nonnegative(),
    payoutStructure: z.record(z.string(), z.number()).default({}),
    visibility: z.enum(["public", "private", "invite_only"]).default("public"),
    isRecurring: z.boolean().default(false),
    recurrenceRule: z.string().max(200).nullable().default(null),
    sponsorName: z.string().max(200).nullable().default(null),
    sponsorLogoUrl: z.string().url().nullable().default(null),
  }),
  z.object({
    action: z.literal("spawn_from_template"),
    templateId: z.string().uuid(),
    registrationOpensAt: z.string().datetime({ offset: true }).optional(),
    registrationClosesAt: z.string().datetime({ offset: true }).optional(),
    checkInOpensAt: z.string().datetime({ offset: true }).optional(),
    startsAt: z.string().datetime({ offset: true }).optional(),
  }),
  z.object({
    action: z.literal("invite"),
    tournamentId: z.string().uuid(),
    invitedUserId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("respond_invitation"),
    invitationId: z.string().uuid(),
    accept: z.boolean(),
  }),
  z.object({
    action: z.literal("reschedule_if_underfilled"),
    tournamentId: z.string().uuid(),
  }),
]);

async function handleGet(ctx: EdgeContext): Promise<Response> {
  const url = new URL(ctx.request.url);
  const query = validateQuery(getQuerySchema, url);
  requireOrganizer(ctx.profile!);

  if (query.view === "ecosystem_health") {
    return successResponse(await getTournamentEcosystemHealth());
  }
  if (query.view === "scheduling_adherence") {
    return successResponse(await getSchedulingAdherence());
  }
  if (query.view === "dashboard") {
    return successResponse(await getOrganizerDashboard(ctx.user!.id));
  }
  if (query.view === "schedule_conflict") {
    if (!query.gameId || !query.registrationOpensAt || !query.startsAt) {
      throw new ValidationError(
        "gameId, registrationOpensAt, and startsAt are required for schedule_conflict.",
      );
    }
    const conflict = await checkOrganizerScheduleConflict(
      ctx.user!.id,
      query.gameId,
      { startsAt: query.registrationOpensAt, endsAt: query.startsAt },
      query.tournamentId,
    );
    return successResponse({ hasConflict: conflict !== null, conflict });
  }

  if (!query.tournamentId) {
    throw new ValidationError("tournamentId is required for this view.");
  }
  await requireTournamentOwnerOrAdmin(ctx, query.tournamentId);

  if (query.view === "participation") {
    return successResponse(
      await getTournamentParticipation(query.tournamentId),
    );
  }
  if (query.view === "revenue") {
    return successResponse(await getTournamentRevenue(query.tournamentId));
  }
  if (query.view === "drop_off") {
    return successResponse(await getTournamentDropOff(query.tournamentId));
  }
  return successResponse(await getTournamentQuality(query.tournamentId));
}

async function handlePost(ctx: EdgeContext): Promise<Response> {
  const body = validateBody(postBodySchema, await parseJsonBody(ctx.request));
  const userId = ctx.user!.id;

  if (body.action === "respond_invitation") {
    // Any player can respond to an invitation addressed to them -- not
    // organizer-gated, mirroring team-manage's respond_invitation.
    await respondToTournamentInvitation(body.invitationId, userId, body.accept);
    return successResponse({ responded: true });
  }

  requireOrganizer(ctx.profile!);

  if (body.action === "create_template") {
    const result = await createTemplate(userId, {
      name: body.name,
      gameId: body.gameId,
      format: body.format,
      entryFeeCents: body.entryFeeCents,
      payoutStructure: body.payoutStructure,
      visibility: body.visibility,
      isRecurring: body.isRecurring,
      recurrenceRule: body.recurrenceRule,
      sponsorName: body.sponsorName,
      sponsorLogoUrl: body.sponsorLogoUrl,
    });
    return successResponse(result, { status: 201 });
  }
  if (body.action === "spawn_from_template") {
    const result = await spawnFromTemplate(userId, body.templateId, {
      registrationOpensAt: body.registrationOpensAt,
      registrationClosesAt: body.registrationClosesAt,
      checkInOpensAt: body.checkInOpensAt,
      startsAt: body.startsAt,
    });
    return successResponse(result, { status: 201 });
  }

  if (body.action === "invite") {
    const result = await inviteToTournament(
      body.tournamentId,
      userId,
      body.invitedUserId,
    );
    return successResponse(result, { status: 201 });
  }

  await requireTournamentOwnerOrAdmin(ctx, body.tournamentId);
  const result = await autoRescheduleIfUnderfilled(body.tournamentId);
  return successResponse(result);
}

function handler(ctx: EdgeContext): Promise<Response> {
  if (ctx.request.method === "GET") return handleGet(ctx);
  if (ctx.request.method === "POST") return handlePost(ctx);
  throw new ValidationError(`Unsupported method ${ctx.request.method}.`);
}

Deno.serve(
  withEdgeFunction(
    {
      functionName: "tournament-organize",
      auth: "required",
      rateLimit: (ctx) => ({
        key: `tournament-organize:${ctx.user!.id}`,
        windowSeconds: 60,
        maxRequests: 20,
      }),
    },
    handler,
  ),
);
