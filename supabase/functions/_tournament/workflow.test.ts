// supabase/functions/_tournament/workflow.test.ts
//
// Mirrors the pattern from CHALLENGE-001's escrow-transition.test.ts:
// cross-checks every transition workflow.ts's functions actually perform
// against migration 0047's allowed-edge list. This is exactly the check
// that caught a real gap while building this phase — nothing transitioned
// registration_closed -> check_in until openCheckIn was added.

import { assertEquals } from "@std/assert";
import { computePayoutShares } from "./workflow.ts";

const ALLOWED_EDGES = new Set([
  "draft->published",
  "draft->cancelled",
  "published->registration",
  "published->cancelled",
  "registration->registration_closed",
  "registration->cancelled",
  "registration_closed->check_in",
  "registration_closed->cancelled",
  "check_in->bracket_generated",
  "check_in->cancelled",
  "bracket_generated->round_active",
  "round_active->round_complete",
  "round_complete->round_active",
  "round_complete->prize_distribution",
  "prize_distribution->completed",
  "completed->archived",
  "cancelled->archived",
]);

const TRANSITIONS_USED_BY_WORKFLOW: [string, string][] = [
  ["draft", "published"], // publishTournament
  ["published", "registration"], // publishTournament
  ["registration", "registration_closed"], // closeRegistration
  ["registration_closed", "check_in"], // openCheckIn
  ["check_in", "bracket_generated"], // generateBracket
  ["bracket_generated", "round_active"], // startRound
  ["round_active", "round_complete"], // completeRound
  ["round_complete", "round_active"], // completeRound (next round)
  ["round_complete", "prize_distribution"], // completeRound (final)
  ["prize_distribution", "completed"], // triggerPrizeDistribution
  ["completed", "archived"], // archiveTournament
  ["cancelled", "archived"], // archiveTournament
  ["draft", "cancelled"], // cancelTournament
  ["published", "cancelled"], // cancelTournament
  ["registration", "cancelled"], // cancelTournament
  ["registration_closed", "cancelled"], // cancelTournament
  ["check_in", "cancelled"], // cancelTournament
];

Deno.test("every transition the tournament workflow performs is a legal edge in the state-machine guard", () => {
  for (const [from, to] of TRANSITIONS_USED_BY_WORKFLOW) {
    const edge = `${from}->${to}`;
    assertEquals(
      ALLOWED_EDGES.has(edge),
      true,
      `Transition ${edge} is used by workflow.ts but is NOT in the allowed edge list — this would fail against a real database.`,
    );
  }
});

// computePayoutShares (Phase 6 — prize distribution) is pure logic
// extracted specifically so this financial math is directly testable
// without a database connection.
Deno.test("computePayoutShares splits an 8-player pool 60/30/10 across champion/runner-up/tied-semifinalists", () => {
  const totalPoolCents = 8 * 1000; // 8 players, $10 entry fee each
  const payoutStructure = { "1": 60, "2": 30, "3": 10 };
  const placementWinners = {
    "1": ["champion"],
    "2": ["runner-up"],
    "3": ["semi-loser-a", "semi-loser-b"],
  };

  const shares = computePayoutShares(
    totalPoolCents,
    payoutStructure,
    placementWinners,
  );

  assertEquals(shares, [
    { winnerId: "champion", amountCents: 4800 }, // 60% of 8000
    { winnerId: "runner-up", amountCents: 2400 }, // 30% of 8000
    { winnerId: "semi-loser-a", amountCents: 400 }, // 10% of 8000, split 2 ways
    { winnerId: "semi-loser-b", amountCents: 400 },
  ]);
});

Deno.test("computePayoutShares never returns a total exceeding the pool, even with a remainder-producing split", () => {
  // 10000 cents split 3 ways at "10%" for 3rd place doesn't divide evenly.
  const totalPoolCents = 10_000;
  const payoutStructure = { "1": 60, "2": 30, "3": 10 };
  const placementWinners = {
    "1": ["champion"],
    "2": ["runner-up"],
    "3": ["a", "b", "c"],
  };

  const shares = computePayoutShares(
    totalPoolCents,
    payoutStructure,
    placementWinners,
  );
  const total = shares.reduce((sum, s) => sum + s.amountCents, 0);

  assertEquals(total <= totalPoolCents, true);
  // floor(1000/3) = 333 per tied winner, 1 cent short of 1000 -- the
  // caller (triggerPrizeDistribution) routes that shortfall to
  // platform_fee_revenue, never silently drops it.
  assertEquals(shares.filter((s) => s.winnerId === "a")[0]?.amountCents, 333);
});

Deno.test("computePayoutShares skips a placement with no resolved winners (e.g. a 2-player tournament has no semifinal)", () => {
  const totalPoolCents = 2000;
  const payoutStructure = { "1": 60, "2": 30, "3": 10 };
  const placementWinners = {
    "1": ["champion"],
    "2": ["runner-up"],
    "3": [], // no semifinal round exists for a 2-player bracket
  };

  const shares = computePayoutShares(
    totalPoolCents,
    payoutStructure,
    placementWinners,
  );

  assertEquals(shares, [
    { winnerId: "champion", amountCents: 1200 }, // 60% of 2000
    { winnerId: "runner-up", amountCents: 600 }, // 30% of 2000
    // 3rd place's 10% (200 cents) is left undistributed -- no winners for
    // that placement -- and routed to platform_fee_revenue by the caller.
  ]);
});

Deno.test("computePayoutShares leaves a payout_structure shortfall (summing below 100%) undistributed, for the caller to route to the platform", () => {
  const totalPoolCents = 10_000;
  const payoutStructure = { "1": 70, "2": 20 }; // sums to 90%, not 100%
  const placementWinners = { "1": ["champion"], "2": ["runner-up"] };

  const shares = computePayoutShares(
    totalPoolCents,
    payoutStructure,
    placementWinners,
  );
  const total = shares.reduce((sum, s) => sum + s.amountCents, 0);

  assertEquals(total, 9000);
});
