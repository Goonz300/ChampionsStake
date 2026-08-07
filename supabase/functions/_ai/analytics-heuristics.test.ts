// supabase/functions/_ai/analytics-heuristics.test.ts

import { assertAlmostEquals, assertEquals } from "@std/assert";
import {
  computeChurnRiskTier,
  computeLinearTrend,
  computePlatformHealthScore,
  computePlayerLtvCents,
  computeTournamentHealthScore,
} from "./analytics-heuristics.ts";

Deno.test("computeChurnRiskTier: recent activity is low risk", () => {
  assertEquals(computeChurnRiskTier(0), "low");
  assertEquals(computeChurnRiskTier(13), "low");
});

Deno.test("computeChurnRiskTier: medium band", () => {
  assertEquals(computeChurnRiskTier(14), "medium");
  assertEquals(computeChurnRiskTier(29), "medium");
});

Deno.test("computeChurnRiskTier: high risk at 30+ days", () => {
  assertEquals(computeChurnRiskTier(30), "high");
  assertEquals(computeChurnRiskTier(365), "high");
});

Deno.test("computePlayerLtvCents: a low-churn-risk player is valued far higher than a high-risk one at the same monthly revenue", () => {
  const lowRisk = computePlayerLtvCents(1000, "low");
  const highRisk = computePlayerLtvCents(1000, "high");
  assertEquals(lowRisk > highRisk, true);
  assertEquals(lowRisk, 12000);
  assertEquals(highRisk, 1000);
});

Deno.test("computeLinearTrend: empty series returns zeros, not NaN/Infinity", () => {
  const { slopePerPeriod, forecastNextPeriod } = computeLinearTrend([]);
  assertEquals(slopePerPeriod, 0);
  assertEquals(forecastNextPeriod, 0);
});

Deno.test("computeLinearTrend: a single point forecasts itself", () => {
  const { forecastNextPeriod } = computeLinearTrend([500]);
  assertEquals(forecastNextPeriod, 500);
});

Deno.test("computeLinearTrend: a perfectly flat series has zero slope", () => {
  const { slopePerPeriod } = computeLinearTrend([100, 100, 100, 100]);
  assertAlmostEquals(slopePerPeriod, 0, 0.001);
});

Deno.test("computeLinearTrend: a clear upward trend produces a positive slope and forecast beyond the last value", () => {
  const { slopePerPeriod, forecastNextPeriod } = computeLinearTrend([
    10,
    20,
    30,
    40,
  ]);
  assertEquals(slopePerPeriod > 0, true);
  assertEquals(forecastNextPeriod > 40, true);
});

Deno.test("computeLinearTrend: forecast never goes negative even on a steep decline", () => {
  const { forecastNextPeriod } = computeLinearTrend([100, 50, 10, 1]);
  assertEquals(forecastNextPeriod >= 0, true);
});

Deno.test("computeTournamentHealthScore: full fill, full completion, and perfect reputation scores 100", () => {
  const score = computeTournamentHealthScore(1, 1, 100);
  assertEquals(score, 100);
});

Deno.test("computeTournamentHealthScore: an empty, incomplete tournament with no reputation track record scores low", () => {
  const score = computeTournamentHealthScore(0, 0, 0);
  assertEquals(score, 0);
});

Deno.test("computePlatformHealthScore: growing revenue and improving fraud trend score higher than the reverse", () => {
  const healthy = computePlatformHealthScore({
    revenueSlope: 10,
    fraudFlagSlope: -1,
    disputeBacklogRatio: 0,
    avgChurnRiskScore: 0,
  });
  const unhealthy = computePlatformHealthScore({
    revenueSlope: -10,
    fraudFlagSlope: 5,
    disputeBacklogRatio: 2,
    avgChurnRiskScore: 100,
  });
  assertEquals(healthy > unhealthy, true);
  assertEquals(healthy, 100);
});
