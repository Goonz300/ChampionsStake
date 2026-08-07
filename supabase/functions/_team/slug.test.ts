// supabase/functions/_team/slug.test.ts

import { assertEquals } from "@std/assert";
import { slugify } from "./slug.ts";

Deno.test("slugify lowercases and hyphenates", () => {
  assertEquals(slugify("Team Liquid"), "team-liquid");
});

Deno.test("slugify strips non-alphanumeric characters", () => {
  assertEquals(slugify("The Best Team!! (2026)"), "the-best-team-2026");
});

Deno.test("slugify trims leading/trailing hyphens", () => {
  assertEquals(slugify("--Clan--"), "clan");
});

Deno.test("slugify caps length at 60 characters", () => {
  const long = "a".repeat(200);
  assertEquals(slugify(long).length, 60);
});

Deno.test("slugify returns empty string for a name with no letters or numbers", () => {
  assertEquals(slugify("!!!"), "");
});
