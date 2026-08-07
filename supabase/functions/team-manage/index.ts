// supabase/functions/team-manage/index.ts
// Consolidates all Team Platform reads/writes behind one function via
// ?view=/action, the same consolidation pattern established by
// admin-wallets/moderator-dashboard/tournament-browse.

import { z } from "zod";
import {
  type EdgeContext,
  withEdgeFunction,
} from "../_shared/middleware/index.ts";
import { requirePlayer } from "../_shared/permissions/index.ts";
import {
  parseJsonBody,
  validateBody,
  validateQuery,
} from "../_shared/validation/validate.ts";
import { successResponse } from "../_shared/response/index.ts";
import { ValidationError } from "../_shared/errors/index.ts";
import {
  getTeamById,
  getTeamBySlug,
  listActiveMembers,
  listInvitationsForUser,
} from "../_team/repository.ts";
import {
  createTeam,
  getTeamStatistics,
  inviteMember,
  leaveTeam,
  promoteToCaptain,
  removeMember,
  respondToInvitation,
  revokeInvitation,
  transferOwnership,
} from "../_team/service.ts";

const getQuerySchema = z.object({
  view: z.enum(["team", "members", "stats", "my_invitations"]).default(
    "team",
  ),
  teamId: z.string().uuid().optional(),
  slug: z.string().optional(),
});

const postBodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    name: z.string().min(2).max(100),
    teamType: z.enum(["team", "organization", "clan"]).default("team"),
    description: z.string().max(1000).nullable().default(null),
    parentOrganizationId: z.string().uuid().nullable().default(null),
  }),
  z.object({
    action: z.literal("invite"),
    teamId: z.string().uuid(),
    invitedUserId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("respond_invitation"),
    invitationId: z.string().uuid(),
    accept: z.boolean(),
  }),
  z.object({
    action: z.literal("revoke_invitation"),
    invitationId: z.string().uuid(),
  }),
  z.object({ action: z.literal("leave"), teamId: z.string().uuid() }),
  z.object({
    action: z.literal("remove_member"),
    teamId: z.string().uuid(),
    targetUserId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("transfer_ownership"),
    teamId: z.string().uuid(),
    newOwnerId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("promote_captain"),
    teamId: z.string().uuid(),
    targetUserId: z.string().uuid(),
  }),
]);

async function handleGet(ctx: EdgeContext): Promise<Response> {
  const url = new URL(ctx.request.url);
  const query = validateQuery(getQuerySchema, url);

  if (query.view === "my_invitations") {
    return successResponse(await listInvitationsForUser(ctx.user!.id));
  }

  if (!query.teamId && !query.slug) {
    throw new ValidationError("teamId or slug is required for this view.");
  }
  const team = query.teamId
    ? await getTeamById(query.teamId)
    : await getTeamBySlug(query.slug!);
  if (!team) throw new ValidationError("Team not found.");

  if (query.view === "members") {
    return successResponse(await listActiveMembers(team.id));
  }
  if (query.view === "stats") {
    return successResponse(await getTeamStatistics(team.id));
  }
  return successResponse(team);
}

async function handlePost(ctx: EdgeContext): Promise<Response> {
  const body = validateBody(postBodySchema, await parseJsonBody(ctx.request));
  const userId = ctx.user!.id;

  if (body.action === "create") {
    const team = await createTeam(
      userId,
      body.name,
      body.teamType,
      body.description,
      body.parentOrganizationId,
    );
    return successResponse(team, { status: 201 });
  }
  if (body.action === "invite") {
    const result = await inviteMember(body.teamId, userId, body.invitedUserId);
    return successResponse(result, { status: 201 });
  }
  if (body.action === "respond_invitation") {
    await respondToInvitation(body.invitationId, userId, body.accept);
    return successResponse({ responded: true });
  }
  if (body.action === "revoke_invitation") {
    await revokeInvitation(body.invitationId, userId);
    return successResponse({ revoked: true });
  }
  if (body.action === "leave") {
    await leaveTeam(body.teamId, userId);
    return successResponse({ left: true });
  }
  if (body.action === "remove_member") {
    await removeMember(body.teamId, userId, body.targetUserId);
    return successResponse({ removed: true });
  }
  if (body.action === "transfer_ownership") {
    await transferOwnership(body.teamId, userId, body.newOwnerId);
    return successResponse({ transferred: true });
  }

  await promoteToCaptain(body.teamId, userId, body.targetUserId);
  return successResponse({ promoted: true });
}

function handler(ctx: EdgeContext): Promise<Response> {
  requirePlayer(ctx.profile!);
  if (ctx.request.method === "GET") return handleGet(ctx);
  if (ctx.request.method === "POST") return handlePost(ctx);
  throw new ValidationError(`Unsupported method ${ctx.request.method}.`);
}

Deno.serve(
  withEdgeFunction(
    {
      functionName: "team-manage",
      auth: "required",
      // Phase 8 (TOURNAMENT-003): reuses Phase 5's layered rate limiting,
      // keyed per-user like every other write-capable consolidated
      // endpoint (admin-wallets, wallet-transfer) -- no new limiter.
      rateLimit: (ctx) => ({
        key: `team-manage:${ctx.user!.id}`,
        windowSeconds: 60,
        maxRequests: 30,
      }),
    },
    handler,
  ),
);
