// supabase/functions/_tournament/bracket.test.ts
//
// Unlike most of this project's domain logic (which touches the DB
// immediately), bracket seeding is pure computation — genuinely fully
// testable offline, no live Postgres required.

import { assertEquals } from "@std/assert";
import {
  computeGrandFinal,
  computeNextLosersRound,
  computeNextRound,
  computeNextSwissRound,
  doubleEliminationGenerator,
  roundRobinGenerator,
  singleEliminationGenerator,
  swissGenerator,
  type SwissStanding,
} from "./bracket.ts";
import type { Registration } from "./types.ts";

function reg(userId: string, seed: number): Registration {
  return {
    tournamentId: "t1",
    userId,
    seed,
    checkedInAt: "2026-01-01T00:00:00Z",
    eliminated: false,
    forfeited: false,
  };
}

Deno.test("8-player bracket produces standard 1v8/4v5/2v7/3v6 seeding", () => {
  const registrations = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) =>
    reg(`p${seed}`, seed)
  );
  const matches = singleEliminationGenerator.generate(registrations);

  assertEquals(matches.length, 4);
  const pairs = matches.map((m) => [m.playerAId, m.playerBId].sort().join("-"));
  assertEquals(pairs.includes(["p1", "p8"].sort().join("-")), true);
  assertEquals(pairs.includes(["p4", "p5"].sort().join("-")), true);
  assertEquals(pairs.includes(["p2", "p7"].sort().join("-")), true);
  assertEquals(pairs.includes(["p3", "p6"].sort().join("-")), true);
});

Deno.test("5-player field gets 3 byes to the top seeds, seed4 vs seed5 play", () => {
  const registrations = [1, 2, 3, 4, 5].map((seed) => reg(`p${seed}`, seed));
  const matches = singleEliminationGenerator.generate(registrations);

  assertEquals(matches.length, 4); // bracket size 8 -> 4 first-round matches

  const byeMatches = matches.filter((m) =>
    m.playerAId === null || m.playerBId === null
  );
  assertEquals(byeMatches.length, 3);

  const realMatch = matches.find((m) =>
    m.playerAId !== null && m.playerBId !== null
  );
  const realPair = [realMatch?.playerAId, realMatch?.playerBId].sort().join(
    "-",
  );
  assertEquals(realPair, ["p4", "p5"].sort().join("-"));
});

Deno.test("excludes registrations that never checked in or forfeited", () => {
  const registrations = [
    reg("p1", 1),
    { ...reg("p2", 2), checkedInAt: null }, // never checked in
    { ...reg("p3", 3), forfeited: true }, // forfeited
    reg("p4", 4),
  ];
  const matches = singleEliminationGenerator.generate(registrations);

  const allPlayers = matches.flatMap((m) => [m.playerAId, m.playerBId]).filter(
    Boolean,
  );
  assertEquals(allPlayers.includes("p2"), false);
  assertEquals(allPlayers.includes("p3"), false);
  assertEquals(allPlayers.includes("p1"), true);
  assertEquals(allPlayers.includes("p4"), true);
});

Deno.test("computeNextRound pairs winners in bracket order", () => {
  const results = [
    { bracketPosition: 0, winnerId: "p1" },
    { bracketPosition: 1, winnerId: "p5" },
    { bracketPosition: 2, winnerId: "p2" },
    { bracketPosition: 3, winnerId: "p6" },
  ];
  const nextRound = computeNextRound(1, results);

  assertEquals(nextRound.length, 2);
  assertEquals(nextRound[0], {
    roundNumber: 2,
    bracketPosition: 0,
    playerAId: "p1",
    playerBId: "p5",
  });
  assertEquals(nextRound[1], {
    roundNumber: 2,
    bracketPosition: 1,
    playerAId: "p2",
    playerBId: "p6",
  });
});

Deno.test("double elimination winners-bracket round 1 uses standard single-elim seeding", () => {
  const registrations = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) =>
    reg(`p${seed}`, seed)
  );
  const matches = doubleEliminationGenerator.generate(registrations);
  const single = singleEliminationGenerator.generate(registrations);
  assertEquals(matches, single);
});

Deno.test("computeNextLosersRound pairs incoming players and places byes last", () => {
  const round = computeNextLosersRound(1, ["a", "b", "c", null]);
  assertEquals(round.length, 2);
  assertEquals(round[0].playerAId, "a");
  assertEquals(round[0].playerBId, "b");
  assertEquals(round[1].playerAId, "c");
  assertEquals(round[1].playerBId, null);
});

Deno.test("computeNextLosersRound: an odd real player count still gets exactly one bye, not a dropped player", () => {
  const round = computeNextLosersRound(1, ["a", "b", "c"]);
  const allPlayers = round.flatMap((m) => [m.playerAId, m.playerBId]);
  assertEquals(allPlayers.includes("a"), true);
  assertEquals(allPlayers.includes("b"), true);
  assertEquals(allPlayers.includes("c"), true);
  assertEquals(allPlayers.filter((p) => p === null).length, 1);
});

Deno.test("computeGrandFinal pairs the winners and losers bracket champions", () => {
  const final = computeGrandFinal(5, "wb-champ", "lb-champ");
  assertEquals(final, {
    roundNumber: 5,
    bracketPosition: 0,
    playerAId: "wb-champ",
    playerBId: "lb-champ",
  });
});

Deno.test("round robin: every player faces every other player exactly once", () => {
  const registrations = [1, 2, 3, 4].map((seed) => reg(`p${seed}`, seed));
  const matches = roundRobinGenerator.generate(registrations);

  // 4 players -> C(4,2) = 6 total matches across 3 rounds.
  assertEquals(matches.length, 6);

  const pairsSeen = new Set(
    matches.map((m) => [m.playerAId, m.playerBId].sort().join("-")),
  );
  assertEquals(pairsSeen.size, 6); // no pair repeated

  const players = ["p1", "p2", "p3", "p4"];
  for (const a of players) {
    for (const b of players) {
      if (a === b) continue;
      const key = [a, b].sort().join("-");
      assertEquals(pairsSeen.has(key), true, `expected ${a} vs ${b}`);
    }
  }
});

Deno.test("round robin: an odd field gets exactly one bye per round", () => {
  const registrations = [1, 2, 3].map((seed) => reg(`p${seed}`, seed));
  const matches = roundRobinGenerator.generate(registrations);

  // 3 players padded to 4 (with a bye) -> 3 rounds, 1 real match per round.
  const byRound = new Map<number, typeof matches>();
  for (const m of matches) {
    byRound.set(m.roundNumber, [...(byRound.get(m.roundNumber) ?? []), m]);
  }
  assertEquals(byRound.size, 3);
  for (const roundMatches of byRound.values()) {
    // n=4 (3 real + 1 bye slot) -> 2 pairings per round, but the pairing
    // involving the bye slot is never pushed as a match at all -- so
    // exactly 1 real match per round, not a null-player placeholder match.
    assertEquals(roundMatches.length, 1);
  }
});

Deno.test("swiss round 1: top half plays bottom half, no top seeds paired together", () => {
  const registrations = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) =>
    reg(`p${seed}`, seed)
  );
  const matches = swissGenerator.generate(registrations);

  assertEquals(matches.length, 4);
  const pairs = matches.map((m) => [m.playerAId, m.playerBId].sort().join("-"));
  assertEquals(pairs.includes(["p1", "p5"].sort().join("-")), true);
  assertEquals(pairs.includes(["p2", "p6"].sort().join("-")), true);
  assertEquals(pairs.includes(["p3", "p7"].sort().join("-")), true);
  assertEquals(pairs.includes(["p4", "p8"].sort().join("-")), true);
});

Deno.test("computeNextSwissRound pairs within score groups and never rematches", () => {
  const standings: SwissStanding[] = [
    { userId: "p1", score: 1, seed: 1, opponentIds: ["p5"] },
    { userId: "p2", score: 1, seed: 2, opponentIds: ["p6"] },
    { userId: "p5", score: 0, seed: 5, opponentIds: ["p1"] },
    { userId: "p6", score: 0, seed: 6, opponentIds: ["p2"] },
  ];
  const round = computeNextSwissRound(2, standings);

  assertEquals(round.length, 2);
  const pairs = round.map((m) => [m.playerAId, m.playerBId].sort().join("-"));
  assertEquals(pairs.includes(["p1", "p2"].sort().join("-")), true); // both on score 1
  assertEquals(pairs.includes(["p5", "p6"].sort().join("-")), true); // both on score 0
  assertEquals(pairs.includes(["p1", "p5"].sort().join("-")), false); // already played
});

Deno.test("computeNextSwissRound floats a player down a score group to avoid forcing a rematch", () => {
  // p1 and p2 are both on score 1 but have already played each other --
  // there's no valid same-group opponent, so one of them must float down
  // to face someone on score 0.
  const standings: SwissStanding[] = [
    { userId: "p1", score: 1, seed: 1, opponentIds: ["p2"] },
    { userId: "p2", score: 1, seed: 2, opponentIds: ["p1"] },
    { userId: "p3", score: 0, seed: 3, opponentIds: ["p4"] },
    { userId: "p4", score: 0, seed: 4, opponentIds: ["p3"] },
  ];
  const round = computeNextSwissRound(2, standings);

  const allPlayers = round.flatMap((m) => [m.playerAId, m.playerBId]);
  assertEquals(allPlayers.includes("p1"), true);
  assertEquals(allPlayers.includes("p2"), true);
  // No match pairs p1 against p2 again.
  for (const m of round) {
    const pair = [m.playerAId, m.playerBId].sort().join("-");
    assertEquals(pair === ["p1", "p2"].sort().join("-"), false);
  }
});
