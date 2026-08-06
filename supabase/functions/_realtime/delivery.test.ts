// Run with: deno test supabase/functions/_realtime/delivery.test.ts
import { assertEquals } from "@std/assert";
import { substitute } from "./delivery.ts";

Deno.test("substitute replaces a single {{variable}} with its value", () => {
  assertEquals(substitute("Hello {{name}}!", { name: "Alex" }), "Hello Alex!");
});

Deno.test("substitute replaces multiple distinct variables", () => {
  assertEquals(
    substitute("{{a}} and {{b}}", { a: "first", b: "second" }),
    "first and second",
  );
});

Deno.test("substitute replaces every occurrence of a repeated variable", () => {
  assertEquals(substitute("{{x}}-{{x}}", { x: "dup" }), "dup-dup");
});

Deno.test("substitute renders a missing variable as an empty string, not the literal placeholder or 'undefined'", () => {
  assertEquals(substitute("Hello {{name}}!", {}), "Hello !");
});

Deno.test("substitute returns undefined for a null template (no crash on an unset template field)", () => {
  assertEquals(substitute(null, { name: "Alex" }), undefined);
});

Deno.test("substitute leaves a template with no placeholders unchanged", () => {
  assertEquals(substitute("Plain text.", { name: "Alex" }), "Plain text.");
});

Deno.test("substitute coerces a non-string variable value to a string", () => {
  assertEquals(substitute("Count: {{count}}", { count: 42 }), "Count: 42");
});
