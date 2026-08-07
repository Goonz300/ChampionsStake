// supabase/functions/_ai/reputation-heuristics.test.ts

import { assertAlmostEquals, assertEquals } from "@std/assert";
import {
  clampScore,
  computeExperienceFactor,
  computeModeratorReputationScore,
  computeOrganizerReputationScore,
  computePlayerReputationScore,
  computeResponseFactor,
  computeTournamentReputationScore,
} from "./reputation-heuristics.ts";

Deno.test("clampScore keeps values within [0, 100]", () => {
  assertEquals(clampScore(150), 100);
  assertEquals(clampScore(-10), 0);
  assertEquals(clampScore(50), 50);
});

Deno.test("computeExperienceFactor: zero matches contributes zero", () => {
  assertEquals(computeExperienceFactor(0), 0);
});

Deno.test("computeExperienceFactor: diminishing returns -- 200 matches isn't 20x more than 10", () => {
  const at10 = computeExperienceFactor(10);
  const at200 = computeExperienceFactor(200);
  assertEquals(at200 > at10, true);
  assertEquals(at200 < at10 * 20, true);
});

Deno.test("computeExperienceFactor caps at 20", () => {
  assertEquals(computeExperienceFactor(1_000_000) <= 20, true);
});

Deno.test("computePlayerReputationScore: perfect completion rate with no experience is not a perfect score", () => {
  const score = computePlayerReputationScore(1.0, 0);
  assertEquals(score, 80);
});

Deno.test("computeResponseFactor: fast response (under 24h) gets full marks", () => {
  assertEquals(computeResponseFactor(10), 100);
  assertEquals(computeResponseFactor(24), 100);
});

Deno.test("computeResponseFactor: tapers to 0 by 96h and never goes negative", () => {
  assertAlmostEquals(computeResponseFactor(96), 0, 0.01);
  assertEquals(computeResponseFactor(500), 0);
});

Deno.test("computeModeratorReputationScore: a high appeal rate dominates even with a fast response time", () => {
  const highAppeals = computeModeratorReputationScore(0.9, 100);
  const noAppeals = computeModeratorReputationScore(0, 100);
  assertEquals(noAppeals > highAppeals, true);
});

Deno.test("computeTournamentReputationScore: a cancelled tournament (no completedBonus) scores lower than a clean completed one", () => {
  const completed = computeTournamentReputationScore(40, 0, 0);
  const cancelled = computeTournamentReputationScore(0, 0, 0);
  assertEquals(completed, 100);
  assertEquals(cancelled, 60);
});

Deno.test("computeOrganizerReputationScore: cancellation rate drags the score down even with great tournaments", () => {
  const noCancellations = computeOrganizerReputationScore(100, 0);
  const halfCancelled = computeOrganizerReputationScore(100, 0.5);
  assertEquals(noCancellations, 100);
  assertEquals(halfCancelled < noCancellations, true);
});
