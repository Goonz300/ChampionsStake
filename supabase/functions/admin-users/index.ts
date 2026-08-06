// supabase/functions/admin-users/index.ts
// GET (search/summary), POST (suspend/reinstate) -- dispatched by an
// `action` field/query param, mirroring the established multi-action
// pattern (wallet-adjustment, tournament-checkin).

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
  getUserSummary,
  reinstateUser,
  searchUsers,
  suspendUser,
} from "../_admin/users.ts";

const getQuerySchema = paginationQuerySchema.extend({
  view: z.enum(["search", "summary"]).default("search"),
  userId: z.string().uuid().optional(),
  search: z.string().optional(),
  status: z.string().optional(),
});

const postBodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("suspend"),
    userId: z.string().uuid(),
    reasonCode: z.string().min(1),
    notes: z.string().default(""),
  }),
  z.object({ action: z.literal("reinstate"), userId: z.string().uuid() }),
]);

async function handleGet(ctx: EdgeContext): Promise<Response> {
  const url = new URL(ctx.request.url);
  const query = validateQuery(getQuerySchema, url);

  if (query.view === "summary") {
    if (!query.userId) {
      throw new ValidationError("userId is required for the summary view.");
    }
    return successResponse(await getUserSummary(query.userId));
  }

  const results = await searchUsers({
    search: query.search,
    status: query.status,
    limit: query.limit,
    cursor: query.cursor,
  });
  return successResponse(results);
}

async function handlePost(ctx: EdgeContext): Promise<Response> {
  const body = validateBody(postBodySchema, await parseJsonBody(ctx.request));

  if (body.action === "suspend") {
    const result = await suspendUser(
      body.userId,
      body.reasonCode,
      body.notes,
      ctx.user!.id,
    );
    return successResponse(result);
  }

  await reinstateUser(body.userId, ctx.user!.id);
  return successResponse({ reinstated: true });
}

function handler(ctx: EdgeContext): Promise<Response> {
  requireAdministrator(ctx.profile!);
  if (ctx.request.method === "GET") return handleGet(ctx);
  if (ctx.request.method === "POST") return handlePost(ctx);
  throw new ValidationError(`Unsupported method ${ctx.request.method}.`);
}

Deno.serve(
  withEdgeFunction({
    functionName: "admin-users",
    auth: "required",
    rateLimit: (ctx) => ({
      key: `admin-users:${ctx.user!.id}`,
      windowSeconds: 60,
      maxRequests: 30,
    }),
  }, handler),
);
