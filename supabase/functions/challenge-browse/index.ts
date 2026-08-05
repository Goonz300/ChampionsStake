// supabase/functions/challenge-browse/index.ts

import { z } from "npm:zod@3.24.1";
import {
  type EdgeContext,
  withEdgeFunction,
} from "../_shared/middleware/index.ts";
import { validateQuery } from "../_shared/validation/validate.ts";
import { paginationQuerySchema } from "../_shared/validation/schemas.ts";
import { paginatedResponse } from "../_shared/response/index.ts";
import { browseChallenges } from "../_challenge/workflow.ts";

const querySchema = paginationQuerySchema.extend({
  gameId: z.string().uuid().optional(),
  platformCode: z.string().optional(),
  regionCode: z.string().optional(),
  minStakeCents: z.coerce.number().int().positive().optional(),
  maxStakeCents: z.coerce.number().int().positive().optional(),
  sort: z.enum([
    "trending",
    "newest",
    "highest_prize",
    "region",
    "friends",
    "recommended",
  ]).default("newest"),
});

async function handler(ctx: EdgeContext): Promise<Response> {
  const url = new URL(ctx.request.url);
  const query = validateQuery(querySchema, url);

  const results = await browseChallenges({
    gameId: query.gameId,
    platformCode: query.platformCode,
    regionCode: query.regionCode,
    minStakeCents: query.minStakeCents,
    maxStakeCents: query.maxStakeCents,
    sort: query.sort,
    userId: ctx.user?.id,
    cursor: query.cursor,
    limit: query.limit,
  });

  const nextCursor = results.length === query.limit
    ? ((results[results.length - 1] as { created_at?: string } | undefined)
      ?.created_at ?? null)
    : null;

  return paginatedResponse(results, { next_cursor: nextCursor });
}

Deno.serve(
  // Public/browse endpoint — visitors and authenticated players alike may
  // browse (Business Rules: public challenges are readable by anyone).
  withEdgeFunction(
    { functionName: "challenge-browse", auth: "optional" },
    handler,
  ),
);
