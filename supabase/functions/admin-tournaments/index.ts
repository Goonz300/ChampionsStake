// supabase/functions/admin-tournaments/index.ts
// Same justification as admin-challenges: "Tournament Management" (Browse,
// Search, Archive, Cancel, View Brackets, View Registrations, View Prize
// Status) has no other entry point beyond TOURNAMENT-001's own
// tournament-archive (archiving only).

import { z } from "npm:zod@3.24.1";
import { withEdgeFunction, type EdgeContext } from "../_shared/middleware/index.ts";
import { requireAdministrator } from "../_shared/permissions/index.ts";
import { validateQuery, validateBody, parseJsonBody } from "../_shared/validation/validate.ts";
import { paginationQuerySchema } from "../_shared/validation/schemas.ts";
import { successResponse } from "../_shared/response/index.ts";
import { ValidationError } from "../_shared/errors/index.ts";
import {
  adminBrowseTournaments,
  adminGetBracket,
  adminGetRegistrations,
  adminGetPrizeStatus,
  adminArchiveTournament,
  adminCancelTournament,
} from "../_admin/tournaments.ts";

const getQuerySchema = paginationQuerySchema.extend({
  view: z.enum(["browse", "bracket", "registrations", "prize_status"]).default("browse"),
  tournamentId: z.string().uuid().optional(),
  status: z.string().optional(),
});

const postBodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("archive"), tournamentId: z.string().uuid() }),
  z.object({ action: z.literal("cancel"), tournamentId: z.string().uuid() }),
]);

async function handleGet(ctx: EdgeContext): Promise<Response> {
  const url = new URL(ctx.request.url);
  const query = validateQuery(getQuerySchema, url);

  if (query.view === "browse") {
    return successResponse(await adminBrowseTournaments({ status: query.status, limit: query.limit, cursor: query.cursor }));
  }
  if (!query.tournamentId) throw new ValidationError("tournamentId is required for this view.");

  if (query.view === "bracket") return successResponse(await adminGetBracket(query.tournamentId));
  if (query.view === "registrations") return successResponse(await adminGetRegistrations(query.tournamentId));
  return successResponse(await adminGetPrizeStatus(query.tournamentId));
}

async function handlePost(ctx: EdgeContext): Promise<Response> {
  const body = validateBody(postBodySchema, await parseJsonBody(ctx.request));

  if (body.action === "archive") {
    await adminArchiveTournament(body.tournamentId);
    return successResponse({ archived: true });
  }

  await adminCancelTournament(body.tournamentId, ctx.user!.id);
  return successResponse({ cancelled: true });
}

async function handler(ctx: EdgeContext): Promise<Response> {
  requireAdministrator(ctx.profile!);
  if (ctx.request.method === "GET") return handleGet(ctx);
  if (ctx.request.method === "POST") return handlePost(ctx);
  throw new ValidationError(`Unsupported method ${ctx.request.method}.`);
}

Deno.serve(withEdgeFunction({ functionName: "admin-tournaments", auth: "required" }, handler));
