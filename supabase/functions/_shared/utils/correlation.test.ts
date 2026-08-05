// Run with: deno test supabase/functions/_shared/utils/correlation.test.ts
import { assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import { generateRequestId, getOrCreateCorrelationId } from "./correlation.ts";

Deno.test("getOrCreateCorrelationId reuses an incoming X-Correlation-Id header", () => {
  const request = new Request("https://example.com", {
    headers: { "X-Correlation-Id": "existing-correlation-id" },
  });
  assertEquals(getOrCreateCorrelationId(request), "existing-correlation-id");
});

Deno.test("getOrCreateCorrelationId generates a fresh UUID when no header is present", () => {
  const request = new Request("https://example.com");
  const id = getOrCreateCorrelationId(request);
  assertEquals(id.length, 36); // UUID string length
});

Deno.test("generateRequestId produces distinct values on each call", () => {
  const a = generateRequestId();
  const b = generateRequestId();
  assertNotEquals(a, b);
});
