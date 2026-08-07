// supabase/functions/_ai/fraud-heuristics.ts
//
// Phase 7 (AI-003): pure, DB-free math extracted out of fraud-detection.ts
// so it's unit-testable without a live database, same convention as
// _ai/elo.ts.

export interface CircularPair {
  from: string;
  to: string;
  forwardCount: number;
  backwardCount: number;
}

/**
 * Given directed edge counts keyed "from->to", finds every unordered pair
 * with edges in BOTH directions -- A paid B and B paid A. Deduplicates so
 * {A,B} is reported once, not twice.
 */
export function findCircularPairs(
  edgeCounts: Record<string, number>,
): CircularPair[] {
  const seenPairs = new Set<string>();
  const results: CircularPair[] = [];

  for (const [key, forwardCount] of Object.entries(edgeCounts)) {
    const [from, to] = key.split("->");
    if (!from || !to) continue;

    const backwardCount = edgeCounts[`${to}->${from}`];
    if (!backwardCount) continue;

    const pairKey = [from, to].sort().join("|");
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);

    results.push({ from, to, forwardCount, backwardCount });
  }

  return results;
}

export interface DurationStats {
  mean: number;
  stddev: number;
}

/** Population standard deviation of a set of durations. */
export function computeDurationStats(durations: number[]): DurationStats {
  if (durations.length === 0) return { mean: 0, stddev: 0 };
  const mean = durations.reduce((a, b) => a + b, 0) / durations.length;
  const variance = durations.reduce((sum, d) => sum + (d - mean) ** 2, 0) /
    durations.length;
  return { mean, stddev: Math.sqrt(variance) };
}

/**
 * Prize-farming gate: a high win rate alone isn't suspicious (a genuinely
 * skilled player can have one); it's only a signal combined with a large
 * trust gap against opponents, and enough matches to rule out variance.
 */
export function isPrizeFarmingPattern(
  matchCount: number,
  winRate: number,
  trustGap: number,
  minMatches: number,
  minWinRate: number,
  minTrustGap: number,
): boolean {
  return matchCount >= minMatches && winRate >= minWinRate &&
    trustGap >= minTrustGap;
}
