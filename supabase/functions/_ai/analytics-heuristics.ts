// supabase/functions/_ai/analytics-heuristics.ts
//
// Phase 7 (AI-007): pure statistical math for the Analytics Engine,
// extracted for unit testing, same convention as every other
// _ai/*-heuristics.ts module.
//
// HONESTY NOTE: "churn prediction" and "revenue forecasting" here are
// rule-based/statistical heuristics (recency tiering, linear trend
// extrapolation) -- NOT a trained ML model. This environment has no
// training pipeline, no labeled churn dataset, and no model-serving
// infrastructure to build one for real; Business Rules §13's own
// "deterministic, reproducible" bar (already applied to trust_score)
// applies here too, so a heuristic that's explainable beats an unverifiable
// claim of ML sophistication this repository cannot actually deliver.

export type ChurnRiskTier = "low" | "medium" | "high";

const CHURN_HIGH_RISK_DAYS = 30;
const CHURN_MEDIUM_RISK_DAYS = 14;

export function computeChurnRiskTier(daysSinceLastSeen: number): ChurnRiskTier {
  if (daysSinceLastSeen >= CHURN_HIGH_RISK_DAYS) return "high";
  if (daysSinceLastSeen >= CHURN_MEDIUM_RISK_DAYS) return "medium";
  return "low";
}

/**
 * Expected remaining lifetime in months, by churn tier -- a coarse,
 * explainable multiplier (not a survival-analysis model), same honesty
 * bar as the rest of this file.
 */
const EXPECTED_REMAINING_MONTHS: Record<ChurnRiskTier, number> = {
  low: 12,
  medium: 4,
  high: 1,
};

export function computePlayerLtvCents(
  avgMonthlyRevenueCents: number,
  churnTier: ChurnRiskTier,
): number {
  return Math.round(
    avgMonthlyRevenueCents * EXPECTED_REMAINING_MONTHS[churnTier],
  );
}

export interface TrendResult {
  slopePerPeriod: number;
  forecastNextPeriod: number;
}

/**
 * Simple linear regression over an evenly-spaced series (e.g. daily
 * revenue totals) -- least-squares slope, then one period extrapolated
 * forward. Deliberately not a seasonal/ARIMA model; documented as a linear
 * trend, not overclaimed as more.
 */
export function computeLinearTrend(series: number[]): TrendResult {
  const n = series.length;
  if (n === 0) return { slopePerPeriod: 0, forecastNextPeriod: 0 };
  if (n === 1) return { slopePerPeriod: 0, forecastNextPeriod: series[0] };

  const xs = series.map((_, i) => i);
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = series.reduce((a, b) => a + b, 0) / n;

  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i++) {
    numerator += (xs[i] - meanX) * (series[i] - meanY);
    denominator += (xs[i] - meanX) ** 2;
  }
  const slope = denominator === 0 ? 0 : numerator / denominator;
  const intercept = meanY - slope * meanX;
  const forecastNextPeriod = Math.max(0, intercept + slope * n);

  return { slopePerPeriod: slope, forecastNextPeriod };
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export function computeTournamentHealthScore(
  fillRate: number,
  completionRate: number,
  reputationScore: number,
): number {
  return clampScore(
    fillRate * 30 + completionRate * 30 + reputationScore * 0.4,
  );
}

export interface PlatformHealthInputs {
  revenueSlope: number; // positive = growing
  fraudFlagSlope: number; // positive = worsening
  disputeBacklogRatio: number; // open disputes / decided disputes in window
  avgChurnRiskScore: number; // 0 (all low-risk) to 100 (all high-risk)
}

export function computePlatformHealthScore(
  inputs: PlatformHealthInputs,
): number {
  const revenueComponent = inputs.revenueSlope >= 0 ? 25 : 10;
  const fraudComponent = inputs.fraudFlagSlope <= 0 ? 25 : 10;
  const backlogComponent = clampScore(25 - inputs.disputeBacklogRatio * 25);
  const churnComponent = clampScore(25 - (inputs.avgChurnRiskScore / 100) * 25);

  return clampScore(
    revenueComponent + fraudComponent + backlogComponent + churnComponent,
  );
}
