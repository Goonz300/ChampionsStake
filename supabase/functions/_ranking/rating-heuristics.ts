// supabase/functions/_ranking/rating-heuristics.ts
//
// Phase 8 (TOURNAMENT-006): pure rating math, extracted for unit testing,
// same convention as every other *-heuristics.ts module. See migration
// 0098's header for why this is Glicko-1 (not Glicko-2) and why it's
// fully independent from Trust Engine v2's trust_score.

const MIN_RATING = 0;
const MAX_RD = 350; // Glickman's own convention: RD ranges [30, 350]
const MIN_RD = 30;

export interface GlickoPlayer {
  rating: number;
  rd: number;
}

export interface GlickoOpponentResult {
  opponent: GlickoPlayer;
  score: 1 | 0.5 | 0; // win / draw / loss
}

const Q = Math.LN10 / 400;

function g(rd: number): number {
  return 1 / Math.sqrt(1 + (3 * Q ** 2 * rd ** 2) / Math.PI ** 2);
}

function expectedScoreGlicko(
  rating: number,
  opponentRating: number,
  opponentRd: number,
): number {
  return 1 / (1 + 10 ** (-g(opponentRd) * (rating - opponentRating) / 400));
}

export interface GlickoUpdateResult {
  newRating: number;
  newRd: number;
}

/**
 * Standard Glicko-1 single-period update against one or more results.
 * Ratings can never go below MIN_RATING (mirrors elo.ts's own floor,
 * matching profiles.trust_score's chk constraint in spirit even though
 * this is a completely separate column/table).
 */
export function computeGlickoUpdate(
  player: GlickoPlayer,
  results: GlickoOpponentResult[],
): GlickoUpdateResult {
  if (results.length === 0) {
    return { newRating: player.rating, newRd: player.rd };
  }

  let dSquaredInverseSum = 0;
  let sumTerm = 0;

  for (const { opponent, score } of results) {
    const gRdJ = g(opponent.rd);
    const eJ = expectedScoreGlicko(player.rating, opponent.rating, opponent.rd);
    dSquaredInverseSum += gRdJ ** 2 * eJ * (1 - eJ);
    sumTerm += gRdJ * (score - eJ);
  }

  const dSquared = 1 / (Q ** 2 * dSquaredInverseSum);
  const newRd = Math.sqrt(1 / (1 / player.rd ** 2 + 1 / dSquared));
  const newRating = player.rating +
    Q / (1 / player.rd ** 2 + 1 / dSquared) * sumTerm;

  return {
    newRating: Math.max(MIN_RATING, newRating),
    newRd: Math.min(MAX_RD, Math.max(MIN_RD, newRd)),
  };
}

// Tuned so a player at the minimum RD (30, maximally certain) returns to
// the maximum RD (350, maximally uncertain -- "we know nothing about this
// player anymore") after roughly a year of inactivity: c^2 = (350^2 -
// 30^2) / 365.
const RD_INACTIVITY_C_SQUARED = (MAX_RD ** 2 - MIN_RD ** 2) / 365;

/**
 * Rating decay: widens (increases uncertainty in) a player's RD the
 * longer they've been inactive -- the Glicko system's own built-in
 * mechanism for "we're less sure about this rating the longer it's been
 * since they played," rather than a bolted-on separate decay concept.
 */
export function computeRatingDecay(
  currentRd: number,
  daysSinceLastMatch: number,
): number {
  const decayed = Math.sqrt(
    currentRd ** 2 + RD_INACTIVITY_C_SQUARED * daysSinceLastMatch,
  );
  return Math.min(MAX_RD, decayed);
}

/**
 * Placement bonus: Glicko already gives new players (starting RD=350,
 * maximum uncertainty) fast-moving ratings for their first several
 * matches by construction -- the "K-factor is high for new players" idea
 * Elo needs as a bolted-on rule is Glicko's DEFAULT BEHAVIOR, not a
 * separate mechanism. This function exists to answer "is this player
 * still in placement" for UI/display purposes (e.g. "Placement Match 3/5"),
 * not to apply an extra rating multiplier on top of Glicko's own RD-based
 * volatility.
 */
const PLACEMENT_MATCH_COUNT = 5;

export function isInPlacement(matchesPlayed: number): boolean {
  return matchesPlayed < PLACEMENT_MATCH_COUNT;
}
