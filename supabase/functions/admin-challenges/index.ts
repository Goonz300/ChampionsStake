// supabase/functions/admin-challenges/index.ts
//
// SCOPE NOTE: not one of the 6 Edge Functions this phase's brief names
// literally, but a justified addition -- "Challenge Management" (Browse,
// Search, Filter, Force Cancel, View Timeline, View Audit) has no other
// entry point. CHALLENGE-001's own challenge-archive already covers
// archiving with admin auth; this function covers everything else this
// phase's Challenge Management section asks for, without duplicating that
// archiving logic (archiveChallengeAdmin below is a direct re-export).

import { z } from "zod";
import {
  type EdgeContext,
  withEdgeFunction,
} from "../_shared/middleware/index.ts";
import { requireAdministrator } from "../_shared/permissions/index.ts";
import {
  parseJsonBody,
  validateBody,
  validateQuery,
} from "../_shared/validation/validate.ts";
import { paginationQuerySchema } from "../_shared/validation/schemas.ts";
import { successResponse } from "../_shared/response/index.ts";
import { ValidationError } from "../_shared/errors/index.ts";
import {
  adminBrowseChallenges,
  archiveChallengeAdmin,
  forceCancelChallenge,
  getChallengeTimelineAdmin,
} from "../_admin/challenges.ts";
import { searchAuditLogs } from "../_admin/audit.ts";

const getQuerySchema = paginationQuerySchema.extend({
  view: z.enum(["browse", "timeline", "audit"]).default("browse"),
  challengeId: z.string().uuid().optional(),
  status: z.string().optional(),
  gameId: z.string().uuid().optional(),
});

const postBodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("force_cancel"),
    challengeId: z.string().uuid(),
    reason: z.string().min(1),
  }),
  z.object({ action: z.literal("archive"), challengeId: z.string().uuid() }),
]);

async function handleGet(ctx: EdgeContext): Promise<Response> {
  const url = new URL(ctx.request.url);
  const query = validateQuery(getQuerySchema, url);

  if (query.view === "browse") {
    return successResponse(
      await adminBrowseChallenges({
        status: query.status,
        gameId: query.gameId,
        limit: query.limit,
        cursor: query.cursor,
      }),
    );
  }
  if (!query.challengeId) {
    throw new ValidationError(
      "challengeId is required for timeline/audit views.",
    );
  }

  if (query.view === "timeline") {
    return successResponse(await getChallengeTimelineAdmin(query.challengeId));
  }

  return successResponse(
    await searchAuditLogs({
      targetTable: "challenges",
      targetId: query.challengeId,
      limit: query.limit,
      cursor: query.cursor,
    }),
  );
}

async function handlePost(ctx: EdgeContext): Promise<Response> {
  const body = validateBody(postBodySchema, await parseJsonBody(ctx.request));

  if (body.action === "force_cancel") {
    await forceCancelChallenge(body.challengeId, ctx.user!.id, body.reason);
    return successResponse({ cancelled: true });
  }

  await archiveChallengeAdmin(body.challengeId);
  return successResponse({ archived: true });
}

function handler(ctx: EdgeContext): Promise<Response> {
  requireAdministrator(ctx.profile!);
  if (ctx.request.method === "GET") return handleGet(ctx);
  if (ctx.request.method === "POST") return handlePost(ctx);
  throw new ValidationError(`Unsupported method ${ctx.request.method}.`);
}

Deno.serve(
  withEdgeFunction(
    { functionName: "admin-challenges", auth: "required" },
    handler,
  ),
);
