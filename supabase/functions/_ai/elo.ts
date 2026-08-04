// supabase/functions/_ai/elo.ts
//
// Business Rules §13/§17: trust score must be "deterministic" and give "a
// reproducible explanation" -- explicitly NOT a black-box ML model. This is
// a standard Elo rating update, the same algorithm chess ratings use,
// chosen specifically because its math is inspectable by a disputing user,
// not because it's the most sophisticated option available.

export interface EloUpdateResult {
  newWinnerRating: number;
  newLoserRating: number;
  winnerDelta: number;
  loserDelta: number;
  expectedWinnerScore: number;
}

const DEFAULT_K_FACTOR = 32;
const MIN_RATING = 0; // matches profiles.trust_score's chk_profiles_trust_score_range check (>= 0)

/**
 * Standard Elo expected-score formula: probability the higher-rated player
 * "should" win, given both ratings.
 */
export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

/**
 * Computes the new ratings after a match. `kFactor` controls how much a
 * single result can move a rating -- higher K means faster-moving, more
 * volatile scores. A future refinement could vary K by account age /
 * number of matches played -- not implemented here, stated as a clean
 * extension point rather than built speculatively.
 */
export function computeEloUpdate(
  winnerRating: number,
  loserRating: number,
  kFactor: number = DEFAULT_K_FACTOR,
): EloUpdateResult {
  const expectedWinnerScore = expectedScore(winnerRating, loserRating);
  const expectedLoserScore = 1 - expectedWinnerScore;

  const winnerDelta = kFactor * (1 - expectedWinnerScore);
  const loserDelta = kFactor * (0 - expectedLoserScore);

  const newWinnerRating = Math.max(MIN_RATING, winnerRating + winnerDelta);
  const newLoserRating = Math.max(MIN_RATING, loserRating + loserDelta);

  return {
    newWinnerRating,
    newLoserRating,
    winnerDelta: newWinnerRating - winnerRating,
    loserDelta: newLoserRating - loserRating,
    expectedWinnerScore,
  };
}

/**
 * Dispute-loss penalty: Business Rules §13 -- "each dispute lost decrements
 * trust score more heavily than a normal loss; each dispute won has no
 * bonus (prevents incentive to manufacture disputes)." Modeled as a flat
 * multiplier on the normal loss delta, applied only to the losing side of
 * a moderator decision -- the winning side gets the normal Elo win delta,
 * no bonus.
 */
const DISPUTE_LOSS_MULTIPLIER = 1.5;

export function computeDisputeLossAdjustment(currentRating: number, normalLossDelta: number): number {
  const amplifiedDelta = normalLossDelta * DISPUTE_LOSS_MULTIPLIER;
  return Math.max(MIN_RATING, currentRating + amplifiedDelta) - currentRating;
}
