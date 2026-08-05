// supabase/functions/ai-recommendations/index.ts

import { z } from "zod";
import {
  type EdgeContext,
  withEdgeFunction,
} from "../_shared/middleware/index.ts";
import { requirePlayer } from "../_shared/permissions/index.ts";
import { validateQuery } from "../_shared/validation/validate.ts";
import { successResponse } from "../_shared/response/index.ts";
import { recommendOpponentChallenges } from "../_ai/recommendations.ts";

const querySchema = z.object({
  limit: z.coerce.number().int().positive().max(50).default(20),
});

async function handler(ctx: EdgeContext): Promise<Response> {
  requirePlayer(ctx.profile!);
  const url = new URL(ctx.request.url);
  const query = validateQuery(querySchema, url);
  const results = await recommendOpponentChallenges(ctx.user!.id, query.limit);
  return successResponse(results);
}

Deno.serve(
  withEdgeFunction(
    {
      functionName: "ai-recommendations",
      auth: "required",
      rateLimit: (ctx) => ({
        key: `ai-recommendations:${ctx.user?.id}`,
        windowSeconds: 60,
        maxRequests: 20,
      }),
    },
    handler,
  ),
);
