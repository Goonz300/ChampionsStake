// supabase/functions/_league/season-service.ts
//
// Phase 8 (TOURNAMENT-005): Season lifecycle workflow, built on migration
// 0095's schema (Phase 8 M3) -- start/end/archive/rewards/rollover.

import { getServiceRoleClient } from "../_shared/database/client.ts";
import { recordAudit } from "../_shared/audit/index.ts";
import { emit } from "../_shared/events/index.ts";
import {
  AuthorizationError,
  ConflictError,
  ValidationError,
} from "../_shared/errors/index.ts";
import { platformToWallet } from "../_wallet/transfer.ts";
import { getWalletByUserIdOrThrow } from "../_wallet/repository.ts";
import {
  getLeagueById,
  listSeasonParticipants,
  toSeason,
} from "./repository.ts";
import { computeSeasonPromotionRelegation } from "./service.ts";
import { computeSeasonRewards } from "./league-heuristics.ts";

const supabase = getServiceRoleClient();

export interface StartSeasonInitialAssignment {
  divisionId: string;
  userId: string | null;
  teamId: string | null;
}

export async function startSeason(
  actorId: string,
  leagueId: string,
  name: string,
  startsAt: string | null,
  endsAt: string | null,
  initialAssignments: StartSeasonInitialAssignment[],
  rewardStructure: Record<string, number> = {},
) {
  const league = await getLeagueById(leagueId);
  if (league.createdBy !== actorId) {
    throw new ValidationError("Only the league creator can start a season.");
  }

  const { data: existingActive } = await supabase
    .from("seasons")
    .select("id")
    .eq("league_id", leagueId)
    .eq("status", "active")
    .maybeSingle();
  if (existingActive) {
    throw new ConflictError(
      "This league already has an active season -- end it before starting a new one.",
    );
  }

  const { data: season, error } = await supabase
    .from("seasons")
    .insert({
      league_id: leagueId,
      name,
      status: "active",
      starts_at: startsAt,
      ends_at: endsAt,
      reward_structure: rewardStructure,
    })
    .select("*")
    .single();
  if (error || !season) {
    throw new Error(`Failed to create season: ${error?.message}`);
  }

  if (initialAssignments.length > 0) {
    const { error: participantsError } = await supabase
      .from("season_participants")
      .insert(
        initialAssignments.map((a) => ({
          season_id: season.id,
          division_id: a.divisionId,
          user_id: a.userId,
          team_id: a.teamId,
        })),
      );
    if (participantsError) {
      throw new Error(
        `Failed to seed season participants: ${participantsError.message}`,
      );
    }
  }

  await recordAudit({
    actorId,
    actorType: actorId ? "user" : "system",
    action: "SeasonStarted",
    category: "tournament",
    targetTable: "seasons",
    targetId: season.id,
    metadata: { leagueId, name, participantCount: initialAssignments.length },
  });

  return toSeason(season);
}

/**
 * Ends a season: marks it completed, computes (but doesn't yet apply)
 * promotion/relegation moves, and distributes rewards if reward_structure
 * is non-empty. Does NOT start the next season -- that's a separate,
 * explicit step (startSeason, seeded with these promotion/relegation
 * results), kept apart so ending a season is never silently coupled to
 * committing to a specific next-season shape.
 */
export async function endSeason(actorId: string | null, seasonId: string) {
  const { data: season } = await supabase
    .from("seasons")
    .select("*")
    .eq("id", seasonId)
    .maybeSingle();
  if (!season) throw new ValidationError(`Season ${seasonId} does not exist.`);
  if (season.status !== "active") {
    throw new ConflictError(
      `Season is not active (current status: ${season.status}).`,
    );
  }

  // actorId === null means this is the automatic rollover sweep (a system
  // actor, no human to check ownership against); a real actorId (a
  // human-triggered call) must be the league's creator.
  if (actorId !== null) {
    const league = await getLeagueById(season.league_id as string);
    if (league.createdBy !== actorId) {
      throw new AuthorizationError(
        "Only the league creator can end this season.",
      );
    }
  }

  // Atomic claim -- the same pattern used throughout Phase 6/7/8 for any
  // "only one caller should transition this row" operation -- so two
  // concurrent end-season calls (e.g. a manual admin action racing the
  // scheduled rollover sweep) can't both apply rewards/promotion twice.
  const { data: claimed, error: claimError } = await supabase
    .from("seasons")
    .update({ status: "completed" })
    .eq("id", seasonId)
    .eq("status", "active")
    .select("*")
    .maybeSingle();
  if (claimError) {
    throw new Error(`Failed to end season: ${claimError.message}`);
  }
  if (!claimed) {
    throw new ConflictError(
      "This season was already ended by another request.",
    );
  }

  const moves = await computeSeasonPromotionRelegation(seasonId);

  const rewardStructure = (claimed.reward_structure ?? {}) as Record<
    string,
    number
  >;
  const rewardsIssued: { participantId: string; amountCents: number }[] = [];

  if (Object.keys(rewardStructure).length > 0) {
    const participants = await listSeasonParticipants(seasonId);
    const ranked = [...participants].sort((a, b) => b.points - a.points);
    const rankedIds = ranked.map((p) => p.userId ?? p.teamId!);
    const rewardAssignments = computeSeasonRewards(rankedIds, rewardStructure);
    const participantById = new Map(rankedIds.map((id, i) => [id, ranked[i]]));

    for (const assignment of rewardAssignments) {
      const participant = participantById.get(assignment.participantId)!;
      const walletId = participant.userId
        ? (await getWalletByUserIdOrThrow(participant.userId)).walletId
        : await getTeamOwnerWalletId(participant.teamId!);

      await platformToWallet(
        walletId,
        assignment.amountCents,
        "season_reward",
        actorId,
        `season-reward-${seasonId}-${participant.id}`,
      );
      rewardsIssued.push({
        participantId: assignment.participantId,
        amountCents: assignment.amountCents,
      });
    }
  }

  await recordAudit({
    actorId,
    actorType: actorId ? "user" : "system",
    action: "SeasonEnded",
    category: "tournament",
    targetTable: "seasons",
    targetId: seasonId,
    metadata: { moveCount: moves.length, rewardsIssued },
  });

  await emit({
    type: "SeasonEnded",
    payload: { seasonId, leagueId: claimed.league_id },
    emittedBy: "season-service",
  });

  return {
    season: toSeason(claimed),
    promotionRelegationMoves: moves,
    rewardsIssued,
  };
}

/** Teams (Phase 8 M2) have no team-owned wallet -- a season reward for a
 * team-based standing is credited to the team's current owner, a
 * documented simplification (see docs/SEASON_PLATFORM_DESIGN.md) rather
 * than building shared team wallets, which is a substantially larger
 * financial-architecture change this milestone doesn't invent. */
async function getTeamOwnerWalletId(teamId: string): Promise<string> {
  const { data: team, error } = await supabase
    .from("teams")
    .select("owner_id")
    .eq("id", teamId)
    .maybeSingle();
  if (error || !team) {
    throw new Error(
      `Failed to resolve team owner for reward payout: ${error?.message}`,
    );
  }
  const wallet = await getWalletByUserIdOrThrow(team.owner_id as string);
  return wallet.walletId;
}

export async function archiveSeason(actorId: string, seasonId: string) {
  const { data: seasonRow } = await supabase
    .from("seasons")
    .select("league_id")
    .eq("id", seasonId)
    .maybeSingle();
  if (!seasonRow) {
    throw new ValidationError(`Season ${seasonId} does not exist.`);
  }

  const league = await getLeagueById(seasonRow.league_id as string);
  if (league.createdBy !== actorId) {
    throw new AuthorizationError(
      "Only the league creator can archive this season.",
    );
  }

  const { data: claimed, error } = await supabase
    .from("seasons")
    .update({ status: "archived", archived_at: new Date().toISOString() })
    .eq("id", seasonId)
    .eq("status", "completed")
    .select("*")
    .maybeSingle();
  if (error) throw new Error(`Failed to archive season: ${error.message}`);
  if (!claimed) {
    throw new ConflictError(
      "Only a completed season can be archived (end it first).",
    );
  }

  await recordAudit({
    actorId,
    actorType: actorId ? "user" : "system",
    action: "SeasonArchived",
    category: "tournament",
    targetTable: "seasons",
    targetId: seasonId,
    metadata: {},
  });

  return toSeason(claimed);
}

/**
 * Automatic rollover: finds active seasons past their ends_at and ends
 * them (which itself is idempotent/atomic-claimed, so a season already
 * ended by a manual admin action in the same window is silently skipped,
 * not double-processed). Does NOT auto-start the next season -- deciding
 * next season's name/dates/reward structure is an organizer/admin
 * decision this sweep does not make unilaterally; it surfaces "this
 * season needs to be rolled over" via the SeasonEnded audit trail for a
 * human (or a future, explicitly-configured auto-start policy) to act on.
 */
export async function rolloverDueSeasons(
  limit = 50,
): Promise<{ ended: number }> {
  const { data: dueSeasons } = await supabase
    .from("seasons")
    .select("id")
    .eq("status", "active")
    .not("ends_at", "is", null)
    .lte("ends_at", new Date().toISOString())
    .limit(limit);

  let ended = 0;
  for (const season of dueSeasons ?? []) {
    try {
      await endSeason(null, season.id);
      ended += 1;
    } catch {
      // A season already ended by a concurrent manual action surfaces as
      // ConflictError here -- expected, not a sweep failure; continue to
      // the next due season rather than aborting the whole sweep.
      continue;
    }
  }

  return { ended };
}
