// supabase/functions/_ai/elo.test.ts

import { assertAlmostEquals, assertEquals } from "jsr:@std/assert@1";
import {
  computeDisputeLossAdjustment,
  computeEloUpdate,
  expectedScore,
} from "./elo.ts";

Deno.test("expectedScore is 0.5 for equal ratings", () => {
  assertEquals(expectedScore(1000, 1000), 0.5);
});

Deno.test("expectedScore favors the higher-rated player", () => {
  const higher = expectedScore(1200, 1000);
  const lower = expectedScore(1000, 1200);
  assertEquals(higher > 0.5, true);
  assertEquals(lower < 0.5, true);
  assertAlmostEquals(higher + lower, 1, 0.0001);
});

Deno.test("equal-rated players: winner gains exactly what loser loses", () => {
  const result = computeEloUpdate(1000, 1000, 32);
  assertAlmostEquals(result.winnerDelta, 16, 0.01);
  assertAlmostEquals(result.loserDelta, -16, 0.01);
  assertAlmostEquals(result.winnerDelta + result.loserDelta, 0, 0.0001);
});

Deno.test("a huge underdog winning gains close to the full K factor", () => {
  const result = computeEloUpdate(800, 1400, 32);
  assertEquals(result.winnerDelta > 30, true);
});

Deno.test("a heavy favorite winning gains very little", () => {
  const result = computeEloUpdate(1400, 800, 32);
  assertEquals(result.winnerDelta < 5, true);
});

Deno.test("rating never drops below the MIN_RATING floor (0, matching the DB check constraint)", () => {
  const result = computeEloUpdate(1500, 5, 32);
  assertEquals(result.newLoserRating >= 0, true);
});

Deno.test("dispute loss adjustment is 1.5x a normal loss and never goes negative", () => {
  const normalLoss = computeEloUpdate(1000, 1000, 32).loserDelta;
  const disputeAdjustment = computeDisputeLossAdjustment(1000, normalLoss);
  assertAlmostEquals(disputeAdjustment, normalLoss * 1.5, 0.01);

  const nearZero = computeDisputeLossAdjustment(5, normalLoss);
  assertEquals(nearZero >= -5, true);
});
