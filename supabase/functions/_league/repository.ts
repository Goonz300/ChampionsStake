// supabase/functions/_league/repository.ts

import { getServiceRoleClient } from "../_shared/database/client.ts";
import { NotFoundError } from "../_shared/errors/index.ts";

export interface League {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  gameId: string;
  regionCode: string | null;
  status: "active" | "archived";
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface Division {
  id: string;
  leagueId: string;
  name: string;
  tier: number;
  createdAt: string;
}

export interface Season {
  id: string;
  leagueId: string;
  name: string;
  status: "upcoming" | "active" | "completed" | "archived";
  startsAt: string | null;
  endsAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SeasonParticipant {
  id: string;
  seasonId: string;
  divisionId: string;
  userId: string | null;
  teamId: string | null;
  wins: number;
  losses: number;
  draws: number;
  points: number;
  createdAt: string;
}

function toLeague(row: Record<string, unknown>): League {
  return {
    id: row.id as string,
    name: row.name as string,
    slug: row.slug as string,
    description: row.description as string | null,
    gameId: row.game_id as string,
    regionCode: row.region_code as string | null,
    status: row.status as League["status"],
    createdBy: row.created_by as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function toDivision(row: Record<string, unknown>): Division {
  return {
    id: row.id as string,
    leagueId: row.league_id as string,
    name: row.name as string,
    tier: row.tier as number,
    createdAt: row.created_at as string,
  };
}

function toSeason(row: Record<string, unknown>): Season {
  return {
    id: row.id as string,
    leagueId: row.league_id as string,
    name: row.name as string,
    status: row.status as Season["status"],
    startsAt: row.starts_at as string | null,
    endsAt: row.ends_at as string | null,
    archivedAt: row.archived_at as string | null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function toSeasonParticipant(row: Record<string, unknown>): SeasonParticipant {
  return {
    id: row.id as string,
    seasonId: row.season_id as string,
    divisionId: row.division_id as string,
    userId: row.user_id as string | null,
    teamId: row.team_id as string | null,
    wins: row.wins as number,
    losses: row.losses as number,
    draws: row.draws as number,
    points: row.points as number,
    createdAt: row.created_at as string,
  };
}

export async function getLeagueById(leagueId: string): Promise<League> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase.from("leagues").select("*").eq(
    "id",
    leagueId,
  ).maybeSingle();
  if (error) throw new Error(`Failed to fetch league: ${error.message}`);
  if (!data) throw new NotFoundError(`League ${leagueId} does not exist.`);
  return toLeague(data);
}

export async function listDivisions(leagueId: string): Promise<Division[]> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("divisions")
    .select("*")
    .eq("league_id", leagueId)
    .order("tier", { ascending: true });
  if (error) throw new Error(`Failed to list divisions: ${error.message}`);
  return (data ?? []).map(toDivision);
}

export async function getSeasonById(seasonId: string): Promise<Season> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase.from("seasons").select("*").eq(
    "id",
    seasonId,
  ).maybeSingle();
  if (error) throw new Error(`Failed to fetch season: ${error.message}`);
  if (!data) throw new NotFoundError(`Season ${seasonId} does not exist.`);
  return toSeason(data);
}

export async function listSeasonsForLeague(
  leagueId: string,
): Promise<Season[]> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("seasons")
    .select("*")
    .eq("league_id", leagueId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Failed to list seasons: ${error.message}`);
  return (data ?? []).map(toSeason);
}

export async function listSeasonParticipants(
  seasonId: string,
): Promise<SeasonParticipant[]> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("season_participants")
    .select("*")
    .eq("season_id", seasonId)
    .order("points", { ascending: false });
  if (error) {
    throw new Error(`Failed to list season participants: ${error.message}`);
  }
  return (data ?? []).map(toSeasonParticipant);
}

/** "Historical standings" (the brief's named requirement): every season
 * participation row for one participant across a league's entire history,
 * newest first -- queried directly across seasons, no separate history
 * table needed since season_participants rows are never deleted. */
export async function getHistoricalStandings(
  leagueId: string,
  participantId: string,
  participantType: "user" | "team",
): Promise<(SeasonParticipant & { seasonName: string })[]> {
  const supabase = getServiceRoleClient();
  const column = participantType === "user" ? "user_id" : "team_id";
  // Sorted in application code rather than relying on PostgREST's
  // embedded-resource order syntax for a joined table's column, which this
  // codebase has no established precedent for and this environment can't
  // verify against a live instance -- a plain, unambiguous query plus a
  // JS sort is more certainly correct than an unverified query string.
  const { data, error } = await supabase
    .from("season_participants")
    .select("*, seasons!inner(name, league_id, created_at)")
    .eq(column, participantId)
    .eq("seasons.league_id", leagueId);
  if (error) {
    throw new Error(`Failed to fetch historical standings: ${error.message}`);
  }
  return (data ?? [])
    .map((row) => ({
      ...toSeasonParticipant(row),
      seasonName: (row.seasons as { name: string; created_at: string }).name,
      _seasonCreatedAt:
        (row.seasons as { name: string; created_at: string }).created_at,
    }))
    .sort((a, b) => b._seasonCreatedAt.localeCompare(a._seasonCreatedAt))
    .map(({ _seasonCreatedAt: _drop, ...rest }) => rest);
}

export { toDivision, toLeague, toSeason, toSeasonParticipant };
