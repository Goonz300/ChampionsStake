// supabase/functions/ai-recommendations/index.ts

import { z } from "zod";
import {
  type EdgeContext,
  withEdgeFunction,
} from "../_shared/middleware/index.ts";
import { requirePlayer } from "../_shared/permissions/index.ts";
import { validateQuery } from "../_shared/validation/validate.ts";
import { successResponse } from "../_shared/response/index.ts";
import {
  recommendFriends,
  recommendMatchmakingOpponents,
  recommendOpponentChallenges,
  recommendTournaments,
} from "../_ai/recommendations.ts";

const querySchema = z.object({
  view: z.enum(["challenges", "matchmaking", "friends", "tournaments"])
    .default("challenges"),
  limit: z.coerce.number().int().positive().max(50).default(20),
});

async function handler(ctx: EdgeContext): Promise<Response> {
  requirePlayer(ctx.profile!);
  const url = new URL(ctx.request.url);
  const query = validateQuery(querySchema, url);
  const userId = ctx.user!.id;

  if (query.view === "matchmaking") {
    return successResponse(
      await recommendMatchmakingOpponents(userId, query.limit),
    );
  }
  if (query.view === "friends") {
    return successResponse(await recommendFriends(userId, query.limit));
  }
  if (query.view === "tournaments") {
    return successResponse(await recommendTournaments(userId, query.limit));
  }

  return successResponse(
    await recommendOpponentChallenges(userId, query.limit),
  );
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
