// supabase/functions/ranking-manage/index.ts
// Read-only public endpoint (leaderboards/ratings/history) -- same ?view=
// consolidation pattern as league-manage/team-manage.

import { z } from "zod";
import {
  type EdgeContext,
  withEdgeFunction,
} from "../_shared/middleware/index.ts";
import { requirePlayer } from "../_shared/permissions/index.ts";
import { validateQuery } from "../_shared/validation/validate.ts";
import { successResponse } from "../_shared/response/index.ts";
import { ValidationError } from "../_shared/errors/index.ts";
import {
  getLeaderboard,
  getPlayerRating,
  getRatingHistory,
} from "../_ranking/service.ts";

const scopeTypeSchema = z.enum(["global", "regional", "season", "tournament"])
  .default("global");

const getQuerySchema = z.object({
  view: z.enum(["leaderboard", "player_rating", "history"]).default(
    "leaderboard",
  ),
  gameId: z.string().uuid().optional(),
  scopeType: scopeTypeSchema,
  scopeId: z.string().optional(),
  userId: z.string().uuid().optional(),
  playerRatingId: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
});

async function handleGet(ctx: EdgeContext): Promise<Response> {
  const url = new URL(ctx.request.url);
  const query = validateQuery(getQuerySchema, url);
  const scopeId = query.scopeId ?? null;

  if (query.view === "history") {
    if (!query.playerRatingId) {
      throw new ValidationError(
        "playerRatingId is required for the history view.",
      );
    }
    return successResponse(
      await getRatingHistory(query.playerRatingId, query.limit),
    );
  }

  if (!query.gameId) {
    throw new ValidationError("gameId is required for this view.");
  }

  if (query.view === "player_rating") {
    if (!query.userId) {
      throw new ValidationError(
        "userId is required for the player_rating view.",
      );
    }
    return successResponse(
      await getPlayerRating(
        query.userId,
        query.gameId,
        query.scopeType,
        scopeId,
      ),
    );
  }

  return successResponse(
    await getLeaderboard(query.gameId, query.scopeType, scopeId, query.limit),
  );
}

function handler(ctx: EdgeContext): Promise<Response> {
  requirePlayer(ctx.profile!);
  if (ctx.request.method === "GET") return handleGet(ctx);
  throw new ValidationError(`Unsupported method ${ctx.request.method}.`);
}

Deno.serve(
  withEdgeFunction(
    {
      functionName: "ranking-manage",
      auth: "required",
      rateLimit: (ctx) => ({
        key: `ranking-manage:${ctx.user!.id}`,
        windowSeconds: 60,
        maxRequests: 60, // leaderboard reads are high-frequency, matching browse-style endpoints
      }),
    },
    handler,
  ),
);
