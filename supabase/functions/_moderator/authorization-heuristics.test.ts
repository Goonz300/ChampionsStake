// supabase/functions/_moderator/authorization-heuristics.test.ts
//
// Regression coverage for the hostile-review finding (High): the
// pre-fix version of this check was inverted -- it returned (allowed
// access) in exactly the branch meant to deny it, and never denied
// access under any input. These cases pin the corrected behavior.

import { assertEquals } from "@std/assert";
import { isModeratorAllowedOnDispute } from "./authorization-heuristics.ts";

Deno.test("an administrator is always allowed, regardless of assignment", () => {
  assertEquals(isModeratorAllowedOnDispute("mod-a", "mod-b", true), true);
  assertEquals(isModeratorAllowedOnDispute(null, "mod-b", true), true);
});

Deno.test("an unassigned dispute is allowed for any moderator", () => {
  assertEquals(isModeratorAllowedOnDispute(null, "mod-a", false), true);
});

Deno.test("the assigned moderator is allowed on their own dispute", () => {
  assertEquals(isModeratorAllowedOnDispute("mod-a", "mod-a", false), true);
});

Deno.test("a DIFFERENT moderator is denied -- this is the exact case the pre-fix bug got backwards", () => {
  assertEquals(isModeratorAllowedOnDispute("mod-a", "mod-b", false), false);
});
