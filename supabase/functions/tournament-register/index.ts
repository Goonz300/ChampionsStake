// supabase/functions/tournament-register/index.ts
// POST: register (idempotency-keyed, since it moves money). DELETE: withdraw.

import { z } from "npm:zod@3.24.1";
import { withEdgeFunction, type EdgeContext } from "../_shared/middleware/index.ts";
import { requireVerifiedPlayer } from "../_shared/permissions/index.ts";
import { validateBody, parseJsonBody } from "../_shared/validation/validate.ts";
import { idempotencyKeyHeaderSchema } from "../_shared/validation/schemas.ts";
import { successResponse } from "../_shared/response/index.ts";
import { beginIdempotentRequest, completeIdempotentRequest, failIdempotentRequest } from "../_shared/idempotency/index.ts";
import { ValidationError } from "../_shared/errors/index.ts";
import { registerForTournament, withdrawRegistration } from "../_tournament/workflow.ts";

const bodySchema = z.object({ tournamentId: z.string().uuid() });

async function handlePost(ctx: EdgeContext): Promise<Response> {
  requireVerifiedPlayer(ctx.profile!);
  const idempotencyKey = idempotencyKeyHeaderSchema.parse(ctx.request.headers.get("Idempotency-Key"));
  const body = validateBody(bodySchema, await parseJsonBody(ctx.request));

  const idempotency = await beginIdempotentRequest<{ registered: boolean }>(idempotencyKey, "tournament-register", body);
  if (idempotency.kind === "replayed") {
    return successResponse(idempotency.response.body, { status: idempotency.response.statusCode });
  }

  try {
    await registerForTournament(body.tournamentId, ctx.user!.id, idempotencyKey);
    const responseBody = { registered: true };
    await completeIdempotentRequest(idempotencyKey, 201, responseBody);
    return successResponse(responseBody, { status: 201 });
  } catch (err) {
    await failIdempotentRequest(idempotencyKey);
    throw err;
  }
}

async function handleDelete(ctx: EdgeContext): Promise<Response> {
  requireVerifiedPlayer(ctx.profile!);
  const url = new URL(ctx.request.url);
  const tournamentId = z.string().uuid().parse(url.searchParams.get("tournamentId"));
  await withdrawRegistration(tournamentId, ctx.user!.id);
  return successResponse({ withdrawn: true });
}

async function handler(ctx: EdgeContext): Promise<Response> {
  if (ctx.request.method === "POST") return handlePost(ctx);
  if (ctx.request.method === "DELETE") return handleDelete(ctx);
  throw new ValidationError(`Unsupported method ${ctx.request.method}.`);
}

Deno.serve(
  withEdgeFunction(
    {
      functionName: "tournament-register",
      auth: "required",
      rateLimit: (ctx) => ({ key: `tournament-register:${ctx.user?.id}`, windowSeconds: 60, maxRequests: 10 }),
    },
    handler,
  ),
);
