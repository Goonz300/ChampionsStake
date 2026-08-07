// supabase/functions/_ai/reputation-heuristics.ts
//
// Phase 7 (AI-004): pure scoring math extracted out of reputation-engine.ts
// so it's unit-testable without a live database, same convention as
// elo.ts and fraud-heuristics.ts.

export function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value));
}

/** Diminishing-returns experience bonus -- volume matters, but a player
 * with 200 matches isn't 20x more reputable than one with 10. */
export function computeExperienceFactor(completedChallenges: number): number {
  return Math.min(20, Math.log2(1 + Math.max(0, completedChallenges)) * 4);
}

export function computePlayerReputationScore(
  completionRate: number,
  experienceFactor: number,
): number {
  return clampScore(completionRate * 80 + experienceFactor);
}

/** Full marks under 24h, tapering to 0 by 96h. */
export function computeResponseFactor(avgResponseHours: number): number {
  return clampScore(100 - ((avgResponseHours - 24) / 72) * 100);
}

export function computeModeratorReputationScore(
  appealRate: number,
  responseFactor: number,
): number {
  return clampScore((1 - appealRate) * 70 + responseFactor * 0.3);
}

export function computeTournamentReputationScore(
  completedBonus: number,
  forfeitRate: number,
  disputeRate: number,
): number {
  return clampScore(
    completedBonus + (1 - forfeitRate) * 30 + (1 - disputeRate) * 30,
  );
}

export function computeOrganizerReputationScore(
  avgTournamentScore: number,
  cancellationRate: number,
): number {
  return clampScore(avgTournamentScore * 0.7 + (1 - cancellationRate) * 30);
}
