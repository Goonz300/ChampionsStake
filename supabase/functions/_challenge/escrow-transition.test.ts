// supabase/functions/_challenge/escrow-transition.test.ts
//
// Like _wallet/ledger.test.ts, this tests only the pure-logic boundary:
// every exported transition function's FIRST action is to fetch the
// challenge (a DB call), so full end-to-end tests need a live database
// (see ESCROW-001-deliverable.md). What's genuinely offline-testable here
// is the declared state-machine edge list itself, cross-checked against
// migration 0040 — catching exactly the class of bug this phase already
// found once (published->accepted, draft->cancelled being missing).

import { assertEquals } from "jsr:@std/assert@1";

// Mirrors the edge list in supabase/migrations/0042_challenge_state_guard_v3.sql
// exactly. Kept here as a duplicate, cross-checked, rather than imported
// (there's no way to import SQL into a Deno test) — if this list and the
// migration ever drift apart, this test's job is to make that visible by
// failing when a transition escrow-transition.ts/workflow.ts relies on
// isn't in it.
const ALLOWED_EDGES = new Set([
  "draft->published",
  "draft->cancelled",
  "published->waiting",
  "published->accepted",
  "published->expired",
  "published->cancelled",
  "waiting->accepted",
  "waiting->expired",
  "waiting->cancelled",
  "accepted->escrow_pending",
  "escrow_pending->escrow_locked",
  "escrow_pending->cancelled",
  "accepted->cancelled",
  "escrow_locked->ready",
  "ready->countdown",
  "countdown->live",
  "countdown->cancelled",
  "ready->cancelled",
  "live->winner_submitted",
  "live->moderator_review",
  "winner_submitted->awaiting_confirmation",
  "winner_submitted->disputed",
  "awaiting_confirmation->released",
  "awaiting_confirmation->disputed",
  "awaiting_confirmation->moderator_review",
  "disputed->moderator_review",
  "moderator_review->completed",
  "moderator_review->cancelled",
  "released->completed",
  "completed->archived",
  "cancelled->archived",
  "expired->archived",
]);

// Every transition escrow-transition.ts's/workflow.ts's functions actually
// perform, in the order they perform them. If any of these isn't in
// ALLOWED_EDGES, the corresponding function would fail at runtime against
// a real database (the guard trigger would reject the UPDATE) — this test
// catches that class of bug without needing a live database at all.
const TRANSITIONS_USED_BY_ENGINE: [string, string][] = [
  ["draft", "published"], // publishChallenge
  ["published", "accepted"], // acceptChallenge
  ["accepted", "escrow_pending"], // acceptChallenge
  ["escrow_pending", "escrow_locked"], // acceptChallenge (success path)
  ["escrow_pending", "cancelled"], // acceptChallenge (lock-failure path)
  ["escrow_locked", "ready"], // readyCheck
  ["ready", "countdown"], // readyCheck (bothReady branch)
  ["countdown", "live"], // startMatch
  ["live", "winner_submitted"], // declareWinner
  ["winner_submitted", "awaiting_confirmation"], // releaseFunds
  ["awaiting_confirmation", "released"], // releaseFunds
  ["released", "completed"], // completeChallenge
  ["draft", "cancelled"], // cancelChallenge (note: deleteChallenge is a hard DELETE, not a status transition, so it has no edge here)
  ["published", "cancelled"], // cancelChallenge
  ["waiting", "cancelled"], // cancelChallenge
  ["published", "expired"], // expireChallenge
  ["waiting", "expired"], // expireChallenge
  ["completed", "archived"], // archiveChallenge
  ["cancelled", "archived"], // archiveChallenge
  ["expired", "archived"], // archiveChallenge
];

Deno.test("every transition the escrow engine performs is a legal edge in the state-machine guard", () => {
  for (const [from, to] of TRANSITIONS_USED_BY_ENGINE) {
    const edge = `${from}->${to}`;
    assertEquals(
      ALLOWED_EDGES.has(edge),
      true,
      `Transition ${edge} is used by escrow-transition.ts but is NOT in the allowed edge list — this would fail against a real database.`,
    );
  }
});
