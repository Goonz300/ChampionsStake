// supabase/functions/_tournament/analytics-heuristics.test.ts

import { assertEquals } from "@std/assert";
import {
  computeDropOffFunnel,
  computePrizeEfficiency,
} from "./analytics-heuristics.ts";

Deno.test("computeDropOffFunnel: no drop-off gives 1.0 retention at every stage", () => {
  const funnel = computeDropOffFunnel([
    { stage: "registered", count: 10 },
    { stage: "checked_in", count: 10 },
  ]);
  assertEquals(funnel[0].retainedFromPrevious, 1);
  assertEquals(funnel[1].retainedFromPrevious, 1);
});

Deno.test("computeDropOffFunnel: half drop off gives 0.5 retention", () => {
  const funnel = computeDropOffFunnel([
    { stage: "registered", count: 10 },
    { stage: "checked_in", count: 5 },
  ]);
  assertEquals(funnel[1].retainedFromPrevious, 0.5);
});

Deno.test("computeDropOffFunnel: an empty first stage doesn't divide by zero", () => {
  const funnel = computeDropOffFunnel([
    { stage: "registered", count: 0 },
    { stage: "checked_in", count: 0 },
  ]);
  assertEquals(funnel[1].retainedFromPrevious, 0);
});

Deno.test("computePrizeEfficiency: full distribution is 1.0", () => {
  assertEquals(computePrizeEfficiency(1000, 1000), 1);
});

Deno.test("computePrizeEfficiency: a rounding shortfall is reflected proportionally", () => {
  assertEquals(computePrizeEfficiency(990, 1000), 0.99);
});

Deno.test("computePrizeEfficiency: a zero pool never divides by zero", () => {
  assertEquals(computePrizeEfficiency(0, 0), 0);
});

Deno.test("computePrizeEfficiency: never exceeds 1.0 even if distributed somehow exceeds the pool", () => {
  assertEquals(computePrizeEfficiency(1100, 1000), 1);
});
