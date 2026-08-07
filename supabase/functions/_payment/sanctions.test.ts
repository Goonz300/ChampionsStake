// Run with: deno test supabase/functions/_payment/sanctions.test.ts
import { assertEquals } from "@std/assert";
import { normalizeName } from "./sanctions.ts";

Deno.test("normalizeName lowercases", () => {
  assertEquals(normalizeName("John DOE"), "john doe");
});

Deno.test("normalizeName trims leading/trailing whitespace", () => {
  assertEquals(normalizeName("  John Doe  "), "john doe");
});

Deno.test("normalizeName collapses internal repeated whitespace", () => {
  assertEquals(normalizeName("John    Doe"), "john doe");
});

Deno.test("normalizeName treats differently-cased/spaced inputs as equal", () => {
  assertEquals(normalizeName("  JOHN   Doe "), normalizeName("john doe"));
});
