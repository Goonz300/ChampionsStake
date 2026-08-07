// supabase/functions/_ranking/rating-heuristics.test.ts

import { assertAlmostEquals, assertEquals } from "@std/assert";
import {
  computeGlickoUpdate,
  computeRatingDecay,
  isInPlacement,
} from "./rating-heuristics.ts";

Deno.test("computeGlickoUpdate: a win against an equal opponent raises rating", () => {
  const player = { rating: 1500, rd: 200 };
  const opponent = { rating: 1500, rd: 200 };
  const result = computeGlickoUpdate(player, [{ opponent, score: 1 }]);
  assertEquals(result.newRating > 1500, true);
});

Deno.test("computeGlickoUpdate: a loss against an equal opponent lowers rating", () => {
  const player = { rating: 1500, rd: 200 };
  const opponent = { rating: 1500, rd: 200 };
  const result = computeGlickoUpdate(player, [{ opponent, score: 0 }]);
  assertEquals(result.newRating < 1500, true);
});

Deno.test("computeGlickoUpdate: RD shrinks (more certainty) after a result", () => {
  const player = { rating: 1500, rd: 200 };
  const opponent = { rating: 1500, rd: 200 };
  const result = computeGlickoUpdate(player, [{ opponent, score: 1 }]);
  assertEquals(result.newRd < 200, true);
});

Deno.test("computeGlickoUpdate: beating a much lower-rated opponent gains little; beating a much higher-rated opponent gains a lot", () => {
  const player = { rating: 1500, rd: 100 };
  const weakWin = computeGlickoUpdate(player, [
    { opponent: { rating: 1000, rd: 100 }, score: 1 },
  ]);
  const strongWin = computeGlickoUpdate(player, [
    { opponent: { rating: 2000, rd: 100 }, score: 1 },
  ]);
  assertEquals(
    (strongWin.newRating - 1500) > (weakWin.newRating - 1500),
    true,
  );
});

Deno.test("computeGlickoUpdate: an empty result set leaves rating and RD unchanged", () => {
  const player = { rating: 1500, rd: 200 };
  const result = computeGlickoUpdate(player, []);
  assertEquals(result.newRating, 1500);
  assertEquals(result.newRd, 200);
});

Deno.test("computeGlickoUpdate: rating never drops below 0", () => {
  const player = { rating: 10, rd: 350 };
  const opponent = { rating: 3000, rd: 30 };
  const result = computeGlickoUpdate(player, [{ opponent, score: 0 }]);
  assertEquals(result.newRating >= 0, true);
});

Deno.test("computeRatingDecay: no time passed leaves RD unchanged", () => {
  assertAlmostEquals(computeRatingDecay(100, 0), 100, 0.001);
});

Deno.test("computeRatingDecay: RD widens (grows) the longer a player is inactive", () => {
  const after30Days = computeRatingDecay(50, 30);
  const after365Days = computeRatingDecay(50, 365);
  assertEquals(after365Days > after30Days, true);
  assertEquals(after30Days > 50, true);
});

Deno.test("computeRatingDecay: caps at the maximum RD (350) no matter how long the inactivity", () => {
  const decayed = computeRatingDecay(50, 100_000);
  assertEquals(decayed, 350);
});

Deno.test("isInPlacement: true for the first 5 matches, false afterward", () => {
  assertEquals(isInPlacement(0), true);
  assertEquals(isInPlacement(4), true);
  assertEquals(isInPlacement(5), false);
  assertEquals(isInPlacement(100), false);
});
