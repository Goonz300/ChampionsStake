// supabase/functions/league-manage/index.ts
// Same ?view=/action consolidation pattern as team-manage/admin-wallets.

import { z } from "zod";
import {
  type EdgeContext,
  withEdgeFunction,
} from "../_shared/middleware/index.ts";
import {
  requireOrganizer,
  requirePlayer,
} from "../_shared/permissions/index.ts";
import {
  parseJsonBody,
  validateBody,
  validateQuery,
} from "../_shared/validation/validate.ts";
import { successResponse } from "../_shared/response/index.ts";
import { ValidationError } from "../_shared/errors/index.ts";
import {
  getHistoricalStandings,
  getLeagueById,
  listDivisions,
  listSeasonParticipants,
  listSeasonsForLeague,
} from "../_league/repository.ts";
import {
  computeSeasonPromotionRelegation,
  createDivision,
  createLeague,
  getLeagueStatistics,
} from "../_league/service.ts";
import {
  archiveSeason,
  endSeason,
  startSeason,
} from "../_league/season-service.ts";

const getQuerySchema = z.object({
  view: z.enum([
    "league",
    "divisions",
    "seasons",
    "standings",
    "stats",
    "historical_standings",
    "promotion_relegation_preview",
  ]).default("league"),
  leagueId: z.string().uuid().optional(),
  seasonId: z.string().uuid().optional(),
  participantId: z.string().uuid().optional(),
  participantType: z.enum(["user", "team"]).optional(),
});

const postBodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create_league"),
    name: z.string().min(2).max(100),
    gameId: z.string().uuid(),
    regionCode: z.string().nullable().default(null),
    description: z.string().max(1000).nullable().default(null),
  }),
  z.object({
    action: z.literal("create_division"),
    leagueId: z.string().uuid(),
    name: z.string().min(1).max(100),
    tier: z.number().int().positive(),
  }),
  z.object({
    action: z.literal("start_season"),
    leagueId: z.string().uuid(),
    name: z.string().min(1).max(100),
    startsAt: z.string().datetime({ offset: true }).nullable().default(null),
    endsAt: z.string().datetime({ offset: true }).nullable().default(null),
    initialAssignments: z.array(z.object({
      divisionId: z.string().uuid(),
      userId: z.string().uuid().nullable().default(null),
      teamId: z.string().uuid().nullable().default(null),
    })).default([]),
    rewardStructure: z.record(z.string(), z.number().int().positive())
      .default({}),
  }),
  z.object({ action: z.literal("end_season"), seasonId: z.string().uuid() }),
  z.object({
    action: z.literal("archive_season"),
    seasonId: z.string().uuid(),
  }),
]);

async function handleGet(ctx: EdgeContext): Promise<Response> {
  const url = new URL(ctx.request.url);
  const query = validateQuery(getQuerySchema, url);

  if (query.view === "historical_standings") {
    if (!query.leagueId || !query.participantId || !query.participantType) {
      throw new ValidationError(
        "leagueId, participantId, and participantType are required for historical_standings.",
      );
    }
    return successResponse(
      await getHistoricalStandings(
        query.leagueId,
        query.participantId,
        query.participantType,
      ),
    );
  }

  if (
    query.view === "standings" || query.view === "promotion_relegation_preview"
  ) {
    if (!query.seasonId) {
      throw new ValidationError("seasonId is required for this view.");
    }
    if (query.view === "promotion_relegation_preview") {
      return successResponse(
        await computeSeasonPromotionRelegation(query.seasonId),
      );
    }
    return successResponse(await listSeasonParticipants(query.seasonId));
  }

  if (!query.leagueId) {
    throw new ValidationError("leagueId is required for this view.");
  }
  if (query.view === "divisions") {
    return successResponse(await listDivisions(query.leagueId));
  }
  if (query.view === "seasons") {
    return successResponse(await listSeasonsForLeague(query.leagueId));
  }
  if (query.view === "stats") {
    return successResponse(await getLeagueStatistics(query.leagueId));
  }
  return successResponse(await getLeagueById(query.leagueId));
}

async function handlePost(ctx: EdgeContext): Promise<Response> {
  const body = validateBody(postBodySchema, await parseJsonBody(ctx.request));
  const userId = ctx.user!.id;

  // Hostile review finding (CRITICAL): every action here either creates a
  // league/division/season or ends one and pays out season_reward amounts
  // (see _league/season-service.ts's endSeason -> platformToWallet, which
  // credits a real spendable wallet balance with no admin approval step).
  // This previously ran under the same requirePlayer gate as read-only
  // views, so ANY active player could self-issue an unbounded reward:
  // create a league, create a division, start a season as its sole
  // participant with an attacker-chosen rewardStructure, then end it.
  // Gating creation/lifecycle actions behind requireOrganizer (the same
  // admin-granted role tournament-create/tournament-organize already
  // require for the identical reason -- real money, no self-service fraud
  // track record) closes this the same way that decision closed it there.
  requireOrganizer(ctx.profile!);

  if (body.action === "create_league") {
    const league = await createLeague(
      userId,
      body.name,
      body.gameId,
      body.regionCode,
      body.description,
    );
    return successResponse(league, { status: 201 });
  }

  if (body.action === "create_division") {
    const result = await createDivision(
      userId,
      body.leagueId,
      body.name,
      body.tier,
    );
    return successResponse(result, { status: 201 });
  }
  if (body.action === "start_season") {
    const season = await startSeason(
      userId,
      body.leagueId,
      body.name,
      body.startsAt,
      body.endsAt,
      body.initialAssignments,
      body.rewardStructure,
    );
    return successResponse(season, { status: 201 });
  }
  if (body.action === "end_season") {
    return successResponse(await endSeason(userId, body.seasonId));
  }

  return successResponse(await archiveSeason(userId, body.seasonId));
}

function handler(ctx: EdgeContext): Promise<Response> {
  requirePlayer(ctx.profile!);
  if (ctx.request.method === "GET") return handleGet(ctx);
  if (ctx.request.method === "POST") return handlePost(ctx);
  throw new ValidationError(`Unsupported method ${ctx.request.method}.`);
}

Deno.serve(
  withEdgeFunction(
    {
      functionName: "league-manage",
      auth: "required",
      rateLimit: (ctx) => ({
        key: `league-manage:${ctx.user!.id}`,
        windowSeconds: 60,
        maxRequests: 30,
      }),
    },
    handler,
  ),
);
