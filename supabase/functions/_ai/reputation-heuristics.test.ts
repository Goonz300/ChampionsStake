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
  computeTournamentScaleFactor,
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

// Hostile review finding (High): completedBonus previously applied in
// full to any completed tournament regardless of size -- a 2-player, free
// bracket (the platform minimum) scored identically to a large, real one,
// making organizer/tournament reputation cheap to farm. Fixed by scaling
// completedBonus with computeTournamentScaleFactor before it reaches
// computeTournamentReputationScore.
Deno.test("computeTournamentScaleFactor: a 2-player (platform minimum) bracket earns roughly half credit, not full", () => {
  const factor = computeTournamentScaleFactor(2);
  assertEquals(factor > 0.3 && factor < 0.7, true);
});

Deno.test("computeTournamentScaleFactor: an 8-participant field earns full credit", () => {
  assertAlmostEquals(computeTournamentScaleFactor(8), 1, 0.001);
});

Deno.test("computeTournamentScaleFactor: never exceeds 1 for very large fields", () => {
  assertEquals(computeTournamentScaleFactor(256) <= 1, true);
});

Deno.test("computeTournamentScaleFactor: zero registrations earns zero credit, not a crash", () => {
  assertEquals(computeTournamentScaleFactor(0), 0);
});

Deno.test("computeTournamentScaleFactor is monotonically non-decreasing with registration count", () => {
  const sizes = [0, 1, 2, 4, 8, 16, 32];
  for (let i = 1; i < sizes.length; i++) {
    assertEquals(
      computeTournamentScaleFactor(sizes[i]) >=
        computeTournamentScaleFactor(sizes[i - 1]),
      true,
    );
  }
});

Deno.test("a scaled-down completedBonus for a trivial (2-player) tournament scores lower than a full-credit (8-player) one, all else equal", () => {
  const trivialScore = computeTournamentReputationScore(
    40 * computeTournamentScaleFactor(2),
    0,
    0,
  );
  const realScore = computeTournamentReputationScore(
    40 * computeTournamentScaleFactor(8),
    0,
    0,
  );
  assertEquals(trivialScore < realScore, true);
});
