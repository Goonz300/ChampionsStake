// supabase/functions/_ranking/service.ts
//
// Phase 8 (TOURNAMENT-006): Ranking Platform business logic. Mirrors
// _ai/trust-score.ts's sweep/idempotency shape (poll domain_events,
// dedupe via a history table) since it's the exact same "process a
// completed match" problem, just for a different, independent concept.

import { getServiceRoleClient } from "../_shared/database/client.ts";
import { logger } from "../_shared/logger/index.ts";
import {
  computeGlickoUpdate,
  computeRatingDecay,
  type GlickoPlayer,
} from "./rating-heuristics.ts";

const supabase = getServiceRoleClient();

export interface PlayerRatingRow {
  id: string;
  userId: string;
  gameId: string;
  scopeType: "global" | "regional" | "season" | "tournament";
  scopeId: string | null;
  rating: number;
  glickoRd: number;
  matchesPlayed: number;
  lastMatchAt: string | null;
}

function toRatingRow(row: Record<string, unknown>): PlayerRatingRow {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    gameId: row.game_id as string,
    scopeType: row.scope_type as PlayerRatingRow["scopeType"],
    scopeId: row.scope_id as string | null,
    rating: row.rating as number,
    glickoRd: row.glicko_rd as number,
    matchesPlayed: row.matches_played as number,
    lastMatchAt: row.last_match_at as string | null,
  };
}

/**
 * scope_id is a real NULL for global scope, not an empty string --
 * PostgREST's .eq("col", "") generates `col = ''`, which never matches a
 * NULL column (SQL's `NULL != ''`), so the null case needs .is() instead.
 * The unique index's coalesce(scope_id, '') is a DB-side uniqueness trick
 * only; it doesn't change what value queries need to match.
 */
// deno-lint-ignore no-explicit-any
function filterByScopeId(query: any, scopeId: string | null) {
  return scopeId === null
    ? query.is("scope_id", null)
    : query.eq("scope_id", scopeId);
}

async function getOrCreateRating(
  userId: string,
  gameId: string,
  scopeType: PlayerRatingRow["scopeType"],
  scopeId: string | null,
): Promise<PlayerRatingRow> {
  const { data: existing } = await filterByScopeId(
    supabase
      .from("player_ratings")
      .select("*")
      .eq("user_id", userId)
      .eq("game_id", gameId)
      .eq("scope_type", scopeType),
    scopeId,
  ).maybeSingle();
  if (existing) return toRatingRow(existing);

  const { data: created, error } = await supabase
    .from("player_ratings")
    .insert({
      user_id: userId,
      game_id: gameId,
      scope_type: scopeType,
      scope_id: scopeId,
    })
    .select("*")
    .single();

  if (created) return toRatingRow(created);

  // Race: another concurrent call created the same (user, game, scope) row
  // first -- same insert-then-re-read-on-23505 pattern established in
  // _wallet/escrow-accounts.ts.
  if (error?.code === "23505") {
    const { data: raceWinner } = await filterByScopeId(
      supabase
        .from("player_ratings")
        .select("*")
        .eq("user_id", userId)
        .eq("game_id", gameId)
        .eq("scope_type", scopeType),
      scopeId,
    ).maybeSingle();
    if (raceWinner) return toRatingRow(raceWinner);
  }

  throw new Error(`Failed to create player rating: ${error?.message}`);
}

function applyDecayIfNeeded(rating: PlayerRatingRow): number {
  if (!rating.lastMatchAt) return rating.glickoRd;
  const daysSince = Math.floor(
    (Date.now() - new Date(rating.lastMatchAt).getTime()) /
      (24 * 60 * 60 * 1000),
  );
  if (daysSince <= 0) return rating.glickoRd;
  return computeRatingDecay(rating.glickoRd, daysSince);
}

async function updateRatingForResult(
  userId: string,
  gameId: string,
  opponentUserId: string,
  score: 1 | 0.5 | 0,
  challengeId: string,
  scopeType: PlayerRatingRow["scopeType"] = "global",
  scopeId: string | null = null,
): Promise<void> {
  const [playerRating, opponentRating] = await Promise.all([
    getOrCreateRating(userId, gameId, scopeType, scopeId),
    getOrCreateRating(opponentUserId, gameId, scopeType, scopeId),
  ]);

  const decayedRd = applyDecayIfNeeded(playerRating);
  const player: GlickoPlayer = { rating: playerRating.rating, rd: decayedRd };
  const opponent: GlickoPlayer = {
    rating: opponentRating.rating,
    rd: opponentRating.glickoRd,
  };

  const update = computeGlickoUpdate(player, [{ opponent, score }]);

  await supabase
    .from("player_ratings")
    .update({
      rating: update.newRating,
      glicko_rd: update.newRd,
      matches_played: playerRating.matchesPlayed + 1,
      last_match_at: new Date().toISOString(),
    })
    .eq("id", playerRating.id);

  await supabase.from("rating_history").insert({
    player_rating_id: playerRating.id,
    user_id: userId,
    old_rating: playerRating.rating,
    new_rating: update.newRating,
    delta: update.newRating - playerRating.rating,
    old_rd: decayedRd,
    new_rd: update.newRd,
    opponent_id: opponentUserId,
    challenge_id: challengeId,
    reason: score === 1
      ? "match_win"
      : score === 0
      ? "match_loss"
      : "match_draw",
  });
}

async function alreadyProcessed(
  challengeId: string,
  userId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("rating_history")
    .select("id")
    .eq("challenge_id", challengeId)
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  return Boolean(data);
}

async function applyChallengeResult(challengeId: string): Promise<void> {
  const { data: challenge } = await supabase
    .from("challenges")
    .select(
      "game_id, creator_id, opponent_id, winner_submitted_by, release_reason",
    )
    .eq("id", challengeId)
    .maybeSingle();

  if (!challenge || !challenge.winner_submitted_by || !challenge.opponent_id) {
    return;
  }
  if (challenge.release_reason === "refund_void") return;

  const winnerId = challenge.winner_submitted_by as string;
  const loserId = winnerId === challenge.creator_id
    ? challenge.opponent_id as string
    : challenge.creator_id as string;

  if (await alreadyProcessed(challengeId, winnerId)) return;

  await updateRatingForResult(
    winnerId,
    challenge.game_id as string,
    loserId,
    1,
    challengeId,
  );
  await updateRatingForResult(
    loserId,
    challenge.game_id as string,
    winnerId,
    0,
    challengeId,
  );
}

/** Sweeps recent ChallengeCompleted events -- same bounded-window,
 * idempotency-checked-per-row sweep shape as trust-score.ts. */
export async function sweepRatingUpdates(
  lookbackHours = 24,
  limit = 200,
): Promise<{ scanned: number; adjusted: number }> {
  const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000)
    .toISOString();

  const { data: events, error } = await supabase
    .from("domain_events")
    .select("*")
    .eq("event_type", "ChallengeCompleted")
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) throw new Error(`Failed to fetch events: ${error.message}`);

  let adjusted = 0;
  for (const event of events ?? []) {
    const challengeId = event.payload?.challengeId;
    if (typeof challengeId !== "string") continue;
    try {
      await applyChallengeResult(challengeId);
      adjusted += 1;
    } catch (err) {
      logger.error("Failed to process rating update", {
        eventId: event.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { scanned: (events ?? []).length, adjusted };
}

export async function getLeaderboard(
  gameId: string,
  scopeType: PlayerRatingRow["scopeType"] = "global",
  scopeId: string | null = null,
  limit = 50,
): Promise<PlayerRatingRow[]> {
  const { data, error } = await filterByScopeId(
    supabase
      .from("player_ratings")
      .select("*")
      .eq("game_id", gameId)
      .eq("scope_type", scopeType),
    scopeId,
  )
    .order("rating", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Failed to fetch leaderboard: ${error.message}`);
  return (data ?? []).map(toRatingRow);
}

export function getPlayerRating(
  userId: string,
  gameId: string,
  scopeType: PlayerRatingRow["scopeType"] = "global",
  scopeId: string | null = null,
): Promise<PlayerRatingRow> {
  return getOrCreateRating(userId, gameId, scopeType, scopeId);
}

export async function getRatingHistory(
  playerRatingId: string,
  limit = 50,
) {
  const { data, error } = await supabase
    .from("rating_history")
    .select("*")
    .eq("player_rating_id", playerRatingId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    throw new Error(`Failed to fetch rating history: ${error.message}`);
  }
  return data ?? [];
}
