// supabase/functions/_ai/matchmaking-heuristics.test.ts

import { assertEquals } from "@std/assert";
import {
  computeMatchmakingScore,
  computeTrustProximityScore,
} from "./matchmaking-heuristics.ts";

const baseFactors = {
  trustGap: 0,
  sameTimezone: false,
  sameRegion: false,
  candidateRecentlyActive: false,
  candidateDeviceFlagged: false,
  hasCollusionHistory: false,
};

Deno.test("computeTrustProximityScore: full credit inside the tight band", () => {
  assertEquals(computeTrustProximityScore(0), 40);
  assertEquals(computeTrustProximityScore(50), 40);
});

Deno.test("computeTrustProximityScore: zero credit at/beyond the wide gap", () => {
  assertEquals(computeTrustProximityScore(400), 0);
  assertEquals(computeTrustProximityScore(1000), 0);
});

Deno.test("computeTrustProximityScore: tapers linearly, never a hard cutoff", () => {
  const mid = computeTrustProximityScore(225); // halfway between 50 and 400
  assertEquals(mid > 0 && mid < 40, true);
});

Deno.test("computeMatchmakingScore: a perfect match on every positive signal scores 100", () => {
  const score = computeMatchmakingScore({
    ...baseFactors,
    sameTimezone: true,
    sameRegion: true,
    candidateRecentlyActive: true,
  });
  assertEquals(score, 100);
});

Deno.test("computeMatchmakingScore: collusion history dominates and drags the score down even with a perfect trust match", () => {
  const clean = computeMatchmakingScore(baseFactors);
  const colluding = computeMatchmakingScore({
    ...baseFactors,
    hasCollusionHistory: true,
  });
  assertEquals(colluding < clean, true);
  assertEquals(colluding, 0); // 40 trust points - 60 penalty, clamped at 0
});

Deno.test("computeMatchmakingScore: a flagged device never fully cancels out a great trust match", () => {
  const flagged = computeMatchmakingScore({
    ...baseFactors,
    candidateDeviceFlagged: true,
  });
  assertEquals(flagged, 40); // still gets full trust-proximity credit
});

Deno.test("computeMatchmakingScore never goes below 0 or above 100", () => {
  const min = computeMatchmakingScore({
    ...baseFactors,
    trustGap: 5000,
    candidateDeviceFlagged: true,
    hasCollusionHistory: true,
  });
  assertEquals(min, 0);

  const max = computeMatchmakingScore({
    ...baseFactors,
    sameTimezone: true,
    sameRegion: true,
    candidateRecentlyActive: true,
  });
  assertEquals(max <= 100, true);
});
