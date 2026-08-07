// supabase/functions/_ai/fraud-heuristics.test.ts

import { assertEquals } from "@std/assert";
import {
  computeDurationStats,
  findCircularPairs,
  isPrizeFarmingPattern,
} from "./fraud-heuristics.ts";

Deno.test("findCircularPairs finds a genuine A->B, B->A cycle", () => {
  const pairs = findCircularPairs({ "A->B": 2, "B->A": 1 });
  assertEquals(pairs.length, 1);
  assertEquals(pairs[0].from, "A");
  assertEquals(pairs[0].to, "B");
  assertEquals(pairs[0].forwardCount, 2);
  assertEquals(pairs[0].backwardCount, 1);
});

Deno.test("findCircularPairs ignores a one-directional transfer", () => {
  const pairs = findCircularPairs({ "A->B": 3 });
  assertEquals(pairs.length, 0);
});

Deno.test("findCircularPairs deduplicates -- reports {A,B} once, not twice", () => {
  const pairs = findCircularPairs({ "A->B": 1, "B->A": 1 });
  assertEquals(pairs.length, 1);
});

Deno.test("findCircularPairs handles multiple independent cycles", () => {
  const pairs = findCircularPairs({
    "A->B": 1,
    "B->A": 1,
    "C->D": 2,
    "D->C": 2,
    "E->F": 1, // one-directional, should not appear
  });
  assertEquals(pairs.length, 2);
});

Deno.test("computeDurationStats: identical durations have zero stddev", () => {
  const { mean, stddev } = computeDurationStats([10, 10, 10, 10]);
  assertEquals(mean, 10);
  assertEquals(stddev, 0);
});

Deno.test("computeDurationStats: empty input returns zeros, not NaN", () => {
  const { mean, stddev } = computeDurationStats([]);
  assertEquals(mean, 0);
  assertEquals(stddev, 0);
});

Deno.test("computeDurationStats: highly variable durations produce a large stddev", () => {
  const { stddev } = computeDurationStats([5, 500, 10, 900, 3]);
  assertEquals(stddev > 100, true);
});

Deno.test("isPrizeFarmingPattern requires all three conditions at once", () => {
  // Enough matches, high win rate, but no trust gap -- a genuinely skilled
  // player beating similarly-trusted opponents is not farming.
  assertEquals(isPrizeFarmingPattern(10, 0.9, 50, 8, 0.85, 300), false);

  // Big trust gap but too few matches to rule out variance.
  assertEquals(isPrizeFarmingPattern(3, 0.9, 400, 8, 0.85, 300), false);

  // Big trust gap and enough matches, but win rate below the threshold.
  assertEquals(isPrizeFarmingPattern(10, 0.7, 400, 8, 0.85, 300), false);

  // All three conditions met.
  assertEquals(isPrizeFarmingPattern(10, 0.9, 400, 8, 0.85, 300), true);
});
