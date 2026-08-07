// supabase/functions/challenge-create/index.ts

import {
  type EdgeContext,
  withEdgeFunction,
} from "../_shared/middleware/index.ts";
import { requireVerifiedPlayer } from "../_shared/permissions/index.ts";
import { parseJsonBody, validateBody } from "../_shared/validation/validate.ts";
import { successResponse } from "../_shared/response/index.ts";
import {
  createChallenge,
  createChallengeSchema,
} from "../_challenge/workflow.ts";
import { getServiceRoleClient } from "../_shared/database/client.ts";
import { checkVelocity } from "../_shared/security/velocity.ts";
import { config } from "../_shared/config/index.ts";

async function handler(ctx: EdgeContext): Promise<Response> {
  requireVerifiedPlayer(ctx.profile!);

  const body = validateBody(
    createChallengeSchema,
    await parseJsonBody(ctx.request),
  );
  const result = await createChallenge(ctx.user!.id, body);

  return successResponse(result, { status: 201 });
}

// Layer 6/15 (Velocity Detection / Middleware Integration): flags, never
// blocks -- runs after the handler above via the framework's fraudCheck
// stage (compose.ts), rather than inline post-handler code.
async function fraudCheck(ctx: EdgeContext): Promise<void> {
  const { windowSeconds, maxCount } = config.fraud.challengeCreationVelocity;
  const since = new Date(Date.now() - windowSeconds * 1000).toISOString();
  const { count } = await getServiceRoleClient()
    .from("challenges")
    .select("id", { count: "exact", head: true })
    .eq("creator_id", ctx.user!.id)
    .gte("created_at", since);
  await checkVelocity({
    userId: ctx.user!.id,
    signal: "challenge_creation",
    count: count ?? 0,
    maxCount,
    windowSeconds,
  });
}

Deno.serve(
  withEdgeFunction(
    {
      functionName: "challenge-create",
      auth: "required",
      rateLimit: (ctx) => ({
        key: `challenge-create:${ctx.user?.id}`,
        windowSeconds: 60,
        maxRequests: 20,
      }),
      fraudCheck,
    },
    handler,
  ),
);
