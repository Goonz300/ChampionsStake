// supabase/functions/_league/service.ts
//
// Phase 8 (TOURNAMENT-004): League Platform business logic. Reuses
// recordAudit/rate-limiting/RBAC the same way every other new Phase 8
// module does -- no new middleware.

import { getServiceRoleClient } from "../_shared/database/client.ts";
import { recordAudit } from "../_shared/audit/index.ts";
import { ConflictError, ValidationError } from "../_shared/errors/index.ts";
import { slugify } from "../_team/slug.ts";
import {
  getLeagueById,
  type League,
  listDivisions,
  listSeasonParticipants,
  toLeague,
} from "./repository.ts";
import {
  computePromotionRelegation,
  type DivisionStanding,
  type PromotionRelegationMove,
} from "./league-heuristics.ts";

const supabase = getServiceRoleClient();

export async function createLeague(
  createdBy: string,
  name: string,
  gameId: string,
  regionCode: string | null,
  description: string | null,
): Promise<League> {
  const baseSlug = slugify(name);
  if (!baseSlug) {
    throw new ValidationError(
      "League name must contain at least one letter or number.",
    );
  }

  let slug = baseSlug;
  let attempt = 0;
  let league: Record<string, unknown> | null = null;
  let lastError: { code?: string; message: string } | null = null;

  while (attempt < 5 && !league) {
    const { data, error } = await supabase
      .from("leagues")
      .insert({
        name,
        slug,
        description,
        game_id: gameId,
        region_code: regionCode,
        created_by: createdBy,
      })
      .select("*")
      .single();
    if (data) {
      league = data;
      break;
    }
    lastError = error;
    if (error?.code !== "23505") break;
    attempt += 1;
    slug = `${baseSlug}-${attempt}`;
  }

  if (!league) {
    throw new Error(`Failed to create league: ${lastError?.message}`);
  }

  await recordAudit({
    actorId: createdBy,
    actorType: "user",
    action: "LeagueCreated",
    category: "tournament",
    targetTable: "leagues",
    targetId: league.id as string,
    metadata: { name, gameId },
  });

  return toLeague(league);
}

export async function createDivision(
  actorId: string,
  leagueId: string,
  name: string,
  tier: number,
): Promise<{ id: string }> {
  const league = await getLeagueById(leagueId);
  if (league.createdBy !== actorId) {
    throw new ValidationError("Only the league creator can add divisions.");
  }

  const { data, error } = await supabase
    .from("divisions")
    .insert({ league_id: leagueId, name, tier })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") {
      throw new ConflictError(`Tier ${tier} already exists for this league.`);
    }
    throw new Error(`Failed to create division: ${error.message}`);
  }

  await recordAudit({
    actorId,
    actorType: "user",
    action: "DivisionCreated",
    category: "tournament",
    targetTable: "divisions",
    targetId: data.id,
    metadata: { leagueId, name, tier },
  });

  return { id: data.id };
}

export interface LeagueStatistics {
  divisionCount: number;
  activeSeasonCount: number;
  totalParticipants: number;
}

export async function getLeagueStatistics(
  leagueId: string,
): Promise<LeagueStatistics> {
  const divisions = await listDivisions(leagueId);

  const { data: activeSeasons } = await supabase
    .from("seasons")
    .select("id")
    .eq("league_id", leagueId)
    .eq("status", "active");

  let totalParticipants = 0;
  for (const season of activeSeasons ?? []) {
    const { count } = await supabase
      .from("season_participants")
      .select("id", { count: "exact", head: true })
      .eq("season_id", season.id);
    totalParticipants += count ?? 0;
  }

  return {
    divisionCount: divisions.length,
    activeSeasonCount: (activeSeasons ?? []).length,
    totalParticipants,
  };
}

const DEFAULT_PROMOTE_COUNT = 3;
const DEFAULT_RELEGATE_COUNT = 3;

/**
 * Computes (but does not apply) promotion/relegation moves for a
 * completed season -- read-only. Applying these into the NEXT season's
 * division assignments is Phase 8 M4's "end season" workflow, which calls
 * this as one step, not duplicated here.
 */
export async function computeSeasonPromotionRelegation(
  seasonId: string,
  promoteCount = DEFAULT_PROMOTE_COUNT,
  relegateCount = DEFAULT_RELEGATE_COUNT,
): Promise<PromotionRelegationMove[]> {
  const participants = await listSeasonParticipants(seasonId);
  const divisions = new Map<string, number>();

  const divisionIds = [...new Set(participants.map((p) => p.divisionId))];
  if (divisionIds.length > 0) {
    const { data: divisionRows } = await supabase
      .from("divisions")
      .select("id, tier")
      .in("id", divisionIds);
    for (const row of divisionRows ?? []) {
      divisions.set(row.id as string, row.tier as number);
    }
  }

  const standings: DivisionStanding[] = participants.map((p) => ({
    participantId: p.userId ?? p.teamId!,
    tier: divisions.get(p.divisionId) ?? 1,
    points: p.points,
  }));

  return computePromotionRelegation(standings, promoteCount, relegateCount);
}
