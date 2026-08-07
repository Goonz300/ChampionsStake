// supabase/functions/_league/league-heuristics.test.ts

import { assertEquals } from "@std/assert";
import {
  computePromotionRelegation,
  computeStandingPointsDelta,
  type DivisionStanding,
} from "./league-heuristics.ts";

function standing(id: string, tier: number, points: number): DivisionStanding {
  return { participantId: id, tier, points };
}

Deno.test("computePromotionRelegation: top of a lower tier gets promoted", () => {
  const standings = [
    standing("a", 2, 30),
    standing("b", 2, 25),
    standing("c", 2, 10),
    standing("d", 1, 5),
  ];
  const moves = computePromotionRelegation(standings, 1, 1);
  const promotion = moves.find((m) => m.reason === "promotion");
  assertEquals(promotion?.participantId, "a");
  assertEquals(promotion?.fromTier, 2);
  assertEquals(promotion?.toTier, 1);
});

Deno.test("computePromotionRelegation: bottom of a higher tier gets relegated", () => {
  const standings = [
    standing("a", 1, 30),
    standing("b", 1, 5),
    standing("c", 2, 10),
  ];
  const moves = computePromotionRelegation(standings, 1, 1);
  const relegation = moves.find((m) => m.reason === "relegation");
  assertEquals(relegation?.participantId, "b");
  assertEquals(relegation?.fromTier, 1);
  assertEquals(relegation?.toTier, 2);
});

Deno.test("computePromotionRelegation: the top tier never gets a promotion move", () => {
  const standings = [standing("a", 1, 30), standing("b", 1, 5)];
  const moves = computePromotionRelegation(standings, 1, 1);
  assertEquals(moves.some((m) => m.reason === "promotion"), false);
});

Deno.test("computePromotionRelegation: the bottom tier never gets a relegation move", () => {
  const standings = [standing("a", 2, 30), standing("b", 2, 5)];
  const moves = computePromotionRelegation(standings, 1, 1);
  assertEquals(moves.some((m) => m.reason === "relegation"), false);
});

Deno.test("computePromotionRelegation: a participant is never both promoted and relegated", () => {
  // A middle tier with only 1 participant and promoteCount=relegateCount=1
  // would otherwise select the same participant for both directions.
  const standings = [
    standing("only", 2, 15),
    standing("top", 1, 30),
    standing("bottom", 3, 5),
  ];
  const moves = computePromotionRelegation(standings, 1, 1);
  const onlyMoves = moves.filter((m) => m.participantId === "only");
  assertEquals(onlyMoves.length, 1);
});

Deno.test("computePromotionRelegation: ties are broken deterministically by participantId", () => {
  // Tier 2 needs a tier 1 present too, or tier 2 is both the top and
  // bottom tier in the dataset and no promotion move is generated at all.
  const standings = [
    standing("b", 2, 20),
    standing("a", 2, 20),
    standing("top", 1, 50),
  ];
  const moves1 = computePromotionRelegation(standings, 1, 0);
  const moves2 = computePromotionRelegation([...standings].reverse(), 1, 0);
  assertEquals(moves1[0].participantId, moves2[0].participantId);
  assertEquals(moves1[0].participantId, "a"); // alphabetically first on a points tie
});

Deno.test("computeStandingPointsDelta: standard 3/1/0 scoring", () => {
  assertEquals(computeStandingPointsDelta({ won: true }).points, 3);
  assertEquals(computeStandingPointsDelta({ won: false }).points, 0);
  assertEquals(computeStandingPointsDelta({ won: null }).points, 1);
});

Deno.test("computeStandingPointsDelta: exactly one of won/lost/drew is true", () => {
  const win = computeStandingPointsDelta({ won: true });
  assertEquals([win.won, win.lost, win.drew].filter(Boolean).length, 1);

  const draw = computeStandingPointsDelta({ won: null });
  assertEquals([draw.won, draw.lost, draw.drew].filter(Boolean).length, 1);
});
