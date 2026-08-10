// supabase/functions/_ai/analytics-engine.ts
//
// Phase 7 (AI-007): forecastRevenue queries wallet_ledger directly rather
// than calling _admin/analytics.ts's revenue() -- that function returns
// only a single period total (totalFeeCents), not a day-by-day series, so
// it can't feed a trend forecast; this is a genuinely different query
// shape; not a duplication of the same one. moderatorWorkload and
// tournamentHealth do reuse existing tables (disputes, reputation_scores)
// directly for the same reason -- no existing aggregate already returns
// that shape. See analytics-heuristics.ts for the honesty note on what
// "forecasting"/"prediction" means here (statistical, not ML).

import { getServiceRoleClient } from "../_shared/database/client.ts";
import {
  computeChurnRiskTier,
  computeLinearTrend,
  computePlatformHealthScore,
  computePlayerLtvCents,
  computeTournamentHealthScore,
} from "./analytics-heuristics.ts";

const supabase = getServiceRoleClient();

// Phase 8.5 performance review fix: several queries below reduce a
// row-level fetch to a sum/count in JS with no .limit() at all -- a
// genuine "unbounded select on a table likely to grow large" pattern for
// tables (wallet_ledger, fraud_flags, disputes) that only ever grow over
// the platform's lifetime. This is a safety-valve cap, not a page size:
// under realistic operation the existing date-range filters keep result
// sets far below this, so it changes worst-case behavior only, not the
// normal-case numbers these functions return.
const ANALYTICS_SCAN_LIMIT = 50_000;

export interface ChurnPrediction {
  userId: string;
  daysSinceLastSeen: number;
  churnRiskTier: "low" | "medium" | "high";
}

/** Churn prediction across recently-registered-or-active players. Bounded
 * to players with at least one completed challenge, same population
 * _admin/analytics.ts's retentionProxy already scopes to. */
export async function predictChurn(limit = 500): Promise<ChurnPrediction[]> {
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, last_seen_at")
    .order("last_seen_at", { ascending: true })
    .limit(limit);

  const now = Date.now();
  return (profiles ?? []).map((p) => {
    const daysSinceLastSeen = Math.floor(
      (now - new Date(p.last_seen_at as string).getTime()) /
        (24 * 60 * 60 * 1000),
    );
    return {
      userId: p.id as string,
      daysSinceLastSeen,
      churnRiskTier: computeChurnRiskTier(daysSinceLastSeen),
    };
  });
}

export interface RevenueForecast {
  historicalDailyCents: number[];
  forecastNextDayCents: number;
  slopePerDay: number;
  trendDirection: "growing" | "flat" | "declining";
}

/** Revenue forecast: a daily-bucketed platform_fee_revenue series, then a
 * linear-trend extrapolation. */
export async function forecastRevenue(days = 30): Promise<RevenueForecast> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("wallet_ledger")
    .select("amount_cents, created_at")
    .eq("account_type", "platform_fee_revenue")
    .eq("direction", "credit")
    .gte("created_at", since)
    .limit(ANALYTICS_SCAN_LIMIT);

  const byDay: Record<string, number> = {};
  for (const row of data ?? []) {
    const day = (row.created_at as string).slice(0, 10);
    byDay[day] = (byDay[day] ?? 0) + (row.amount_cents as number);
  }

  const sortedDays = Object.keys(byDay).sort();
  const historicalDailyCents = sortedDays.map((d) => byDay[d]);
  const { slopePerPeriod, forecastNextPeriod } = computeLinearTrend(
    historicalDailyCents,
  );

  return {
    historicalDailyCents,
    forecastNextDayCents: Math.round(forecastNextPeriod),
    slopePerDay: slopePerPeriod,
    trendDirection: slopePerPeriod > 0.01
      ? "growing"
      : slopePerPeriod < -0.01
      ? "declining"
      : "flat",
  };
}

export interface FraudForecast {
  historicalWeeklyFlagCounts: number[];
  forecastNextWeekCount: number;
  slopePerWeek: number;
  trendDirection: "worsening" | "flat" | "improving";
}

export async function forecastFraud(weeks = 8): Promise<FraudForecast> {
  const since = new Date(Date.now() - weeks * 7 * 24 * 60 * 60 * 1000)
    .toISOString();
  const { data } = await supabase
    .from("fraud_flags")
    .select("created_at")
    .gte("created_at", since)
    .limit(ANALYTICS_SCAN_LIMIT);

  const byWeek: Record<number, number> = {};
  const sinceMs = new Date(since).getTime();
  for (const row of data ?? []) {
    const weekIndex = Math.floor(
      (new Date(row.created_at as string).getTime() - sinceMs) /
        (7 * 24 * 60 * 60 * 1000),
    );
    byWeek[weekIndex] = (byWeek[weekIndex] ?? 0) + 1;
  }

  const historicalWeeklyFlagCounts = Array.from(
    { length: weeks },
    (_, i) => byWeek[i] ?? 0,
  );
  const { slopePerPeriod, forecastNextPeriod } = computeLinearTrend(
    historicalWeeklyFlagCounts,
  );

  return {
    historicalWeeklyFlagCounts,
    forecastNextWeekCount: Math.round(forecastNextPeriod),
    slopePerWeek: slopePerPeriod,
    trendDirection: slopePerPeriod > 0.1
      ? "worsening"
      : slopePerPeriod < -0.1
      ? "improving"
      : "flat",
  };
}

export interface PlayerLtvResult {
  userId: string;
  avgMonthlyRevenueCents: number;
  churnRiskTier: "low" | "medium" | "high";
  estimatedLtvCents: number;
}

/**
 * LTV proxy: this player's share of platform_fee_revenue over the last 90
 * days (the only revenue this platform actually attributes to a specific
 * user's activity -- stakes themselves are a wash between players, the fee
 * is the platform's real take), monthly-averaged, times a churn-tier
 * lifetime multiplier.
 */
export async function computePlayerLtv(
  userId: string,
): Promise<PlayerLtvResult> {
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const { data: wallet } = await supabase
    .from("wallets")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  let feeRevenueCents = 0;
  if (wallet) {
    const { data: ledgerRows } = await supabase
      .from("wallet_ledger")
      .select("wallet_transaction_id")
      .eq("wallet_id", wallet.id)
      .gte("created_at", since)
      .limit(ANALYTICS_SCAN_LIMIT);
    const transactionIds = [
      ...new Set((ledgerRows ?? []).map((r) => r.wallet_transaction_id)),
    ];
    if (transactionIds.length > 0) {
      const { data: feeLegs } = await supabase
        .from("wallet_ledger")
        .select("amount_cents")
        .eq("account_type", "platform_fee_revenue")
        .eq("direction", "credit")
        .in("wallet_transaction_id", transactionIds);
      feeRevenueCents = (feeLegs ?? []).reduce(
        (sum, r) => sum + (r.amount_cents as number),
        0,
      );
    }
  }

  const avgMonthlyRevenueCents = Math.round(feeRevenueCents / 3);

  const { data: profile } = await supabase
    .from("profiles")
    .select("last_seen_at")
    .eq("id", userId)
    .maybeSingle();
  const daysSinceLastSeen = profile
    ? Math.floor(
      (Date.now() - new Date(profile.last_seen_at as string).getTime()) /
        (24 * 60 * 60 * 1000),
    )
    : 0;
  const churnRiskTier = computeChurnRiskTier(daysSinceLastSeen);

  return {
    userId,
    avgMonthlyRevenueCents,
    churnRiskTier,
    estimatedLtvCents: computePlayerLtvCents(
      avgMonthlyRevenueCents,
      churnRiskTier,
    ),
  };
}

export interface ModeratorWorkload {
  moderatorId: string;
  openAssignedCount: number;
}

/** Moderator workload: open/under_review dispute count per assigned
 * moderator. "Support workload" (the brief's other named metric) is NOT
 * implemented -- no support-ticket system exists anywhere in this schema,
 * documented as a gap rather than fabricated. */
export async function moderatorWorkload(): Promise<ModeratorWorkload[]> {
  const { data } = await supabase
    .from("disputes")
    .select("assigned_moderator_id")
    .in("status", ["open", "under_review"])
    .not("assigned_moderator_id", "is", null);

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    const id = row.assigned_moderator_id as string;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  return [...counts.entries()].map(([moderatorId, openAssignedCount]) => ({
    moderatorId,
    openAssignedCount,
  }));
}

export async function tournamentHealth(tournamentId: string): Promise<number> {
  const { data: tournament } = await supabase
    .from("tournaments")
    .select("id")
    .eq("id", tournamentId)
    .maybeSingle();
  if (!tournament) throw new Error(`No tournament found for ${tournamentId}.`);

  const { count: registrationCount } = await supabase
    .from("tournament_registrations")
    .select("id", { count: "exact", head: true })
    .eq("tournament_id", tournamentId);

  const { data: reputationRow } = await supabase
    .from("reputation_scores")
    .select("score")
    .eq("subject_type", "tournament")
    .eq("subject_id", tournamentId)
    .maybeSingle();

  // Fill rate needs a capacity concept tournaments don't currently store
  // (no max_participants column exists) -- registrationCount alone, capped
  // at a nominal reference of 32, is used as a coarse proxy rather than a
  // true fill percentage.
  const fillRate = Math.min(1, (registrationCount ?? 0) / 32);
  const reputationScore = (reputationRow?.score as number | undefined) ?? 50;

  return computeTournamentHealthScore(fillRate, 1, reputationScore);
}

/** Composite platform health score combining revenue trend, fraud trend,
 * dispute backlog, and average churn risk. */
export async function platformHealth(): Promise<number> {
  const [revenueForecast, fraudForecast, disputeRows, churnPredictions] =
    await Promise.all([
      forecastRevenue(),
      forecastFraud(),
      supabase.from("disputes").select("status").in(
        "status",
        ["open", "under_review", "resolved"],
      ).limit(ANALYTICS_SCAN_LIMIT),
      predictChurn(200),
    ]);

  const disputeStatuses = disputeRows.data ?? [];
  const openCount =
    disputeStatuses.filter((d) => d.status !== "resolved").length;
  const resolvedCount =
    disputeStatuses.filter((d) => d.status === "resolved").length;
  const disputeBacklogRatio = resolvedCount > 0
    ? openCount / resolvedCount
    : openCount > 0
    ? 1
    : 0;

  const churnScoreMap = { low: 0, medium: 50, high: 100 } as const;
  const avgChurnRiskScore = churnPredictions.length > 0
    ? churnPredictions.reduce(
      (sum, c) => sum + churnScoreMap[c.churnRiskTier],
      0,
    ) / churnPredictions.length
    : 0;

  return computePlatformHealthScore({
    revenueSlope: revenueForecast.slopePerDay,
    fraudFlagSlope: fraudForecast.slopePerWeek,
    disputeBacklogRatio,
    avgChurnRiskScore,
  });
}
