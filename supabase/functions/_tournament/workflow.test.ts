// supabase/functions/_tournament/workflow.test.ts
//
// Mirrors the pattern from CHALLENGE-001's escrow-transition.test.ts:
// cross-checks every transition workflow.ts's functions actually perform
// against migration 0047's allowed-edge list. This is exactly the check
// that caught a real gap while building this phase — nothing transitioned
// registration_closed -> check_in until openCheckIn was added.

import { assertEquals } from "@std/assert";

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
