// supabase/functions/challenge-create/index.ts

import { withEdgeFunction, type EdgeContext } from "../_shared/middleware/index.ts";
import { requireVerifiedPlayer } from "../_shared/permissions/index.ts";
import { validateBody, parseJsonBody } from "../_shared/validation/validate.ts";
import { successResponse } from "../_shared/response/index.ts";
import { createChallengeSchema, createChallenge } from "../_challenge/workflow.ts";

async function handler(ctx: EdgeContext): Promise<Response> {
  requireVerifiedPlayer(ctx.profile!);

  const body = validateBody(createChallengeSchema, await parseJsonBody(ctx.request));
  const result = await createChallenge(ctx.user!.id, body);

  return successResponse(result, { status: 201 });
}

Deno.serve(
  withEdgeFunction(
    {
      functionName: "challenge-create",
      auth: "required",
      rateLimit: (ctx) => ({ key: `challenge-create:${ctx.user?.id}`, windowSeconds: 60, maxRequests: 20 }),
    },
    handler,
  ),
);
