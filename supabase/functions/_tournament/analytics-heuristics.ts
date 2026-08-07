// supabase/functions/_tournament/analytics-heuristics.ts
//
// Phase 8 (TOURNAMENT-009): pure math for Tournament Analytics, extracted
// for unit testing, same convention as every other *-heuristics.ts module.

export interface DropOffFunnelStage {
  stage: string;
  count: number;
  retainedFromPrevious: number; // 1.0 = nobody dropped off this stage
}

/**
 * Turns a raw funnel (registered -> checked_in -> reached each round) into
 * per-stage retention ratios -- the "Drop-off" metric the brief names.
 * Stage counts are expected to be non-increasing (each stage is a subset
 * of the previous); a caller passing an increasing count is a data bug,
 * not something this function corrects for.
 */
export function computeDropOffFunnel(
  stageCounts: { stage: string; count: number }[],
): DropOffFunnelStage[] {
  return stageCounts.map((s, i) => {
    const previous = i === 0 ? s.count : stageCounts[i - 1].count;
    return {
      stage: s.stage,
      count: s.count,
      retainedFromPrevious: previous > 0 ? s.count / previous : 0,
    };
  });
}

/**
 * "Prize efficiency": how much of the total pool was actually distributed.
 * Never exceeds 1 by construction (computePayoutShares in workflow.ts is
 * floor-only, so totalDistributed <= totalPool always holds upstream of
 * this function) -- clamped here anyway as a defensive invariant check,
 * not because this function expects to need it.
 */
export function computePrizeEfficiency(
  totalDistributedCents: number,
  totalPoolCents: number,
): number {
  if (totalPoolCents <= 0) return 0;
  return Math.min(1, totalDistributedCents / totalPoolCents);
}
