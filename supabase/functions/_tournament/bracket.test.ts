// supabase/functions/_tournament/bracket.test.ts
//
// Unlike most of this project's domain logic (which touches the DB
// immediately), bracket seeding is pure computation — genuinely fully
// testable offline, no live Postgres required.

import { assertEquals } from "@std/assert";
import {
  computeNextRound,
  doubleEliminationGenerator,
  singleEliminationGenerator,
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

Deno.test("double elimination throws a clear not-implemented error rather than silently producing a wrong bracket", () => {
  let threw = false;
  try {
    doubleEliminationGenerator.generate();
  } catch (err) {
    threw = true;
    assertEquals(err instanceof Error, true);
    assertEquals(
      (err as Error).message.includes("architecture-ready only"),
      true,
    );
  }
  assertEquals(threw, true);
});
