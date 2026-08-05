// Run with: deno test supabase/functions/_shared/validation/validate.test.ts
import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import { z } from "npm:zod@3.24.1";
import { parseJsonBody, validateBody, validateQuery } from "./validate.ts";
import {
  dateRangeSchema,
  paginationQuerySchema,
  uuidSchema,
} from "./schemas.ts";
import { ValidationError } from "../errors/index.ts";

Deno.test("validateBody returns parsed data for valid input", () => {
  const schema = z.object({ name: z.string() });
  const result = validateBody(schema, { name: "Player1" });
  assertEquals(result.name, "Player1");
});

Deno.test("validateBody throws ValidationError with a descriptive message on invalid input", () => {
  const schema = z.object({ name: z.string() });
  assertThrows(() => validateBody(schema, { name: 123 }), ValidationError);
});

Deno.test("uuidSchema accepts a valid UUID and rejects a non-UUID string", () => {
  assertEquals(
    uuidSchema.safeParse("11111111-1111-1111-1111-111111111111").success,
    true,
  );
  assertEquals(uuidSchema.safeParse("not-a-uuid").success, false);
});

Deno.test("paginationQuerySchema applies defaults and coerces limit to a number", () => {
  const url = new URL("https://example.com/api/x?limit=50");
  const result = validateQuery(paginationQuerySchema, url);
  assertEquals(result.limit, 50);
  assertEquals(result.cursor, undefined);
});

Deno.test("paginationQuerySchema rejects a limit above the configured max", () => {
  const url = new URL("https://example.com/api/x?limit=99999");
  assertThrows(
    () => validateQuery(paginationQuerySchema, url),
    ValidationError,
  );
});

Deno.test("dateRangeSchema accepts from <= to", () => {
  const result = dateRangeSchema.safeParse({
    from: "2026-01-01T00:00:00Z",
    to: "2026-02-01T00:00:00Z",
  });
  assertEquals(result.success, true);
});

Deno.test("dateRangeSchema rejects from > to", () => {
  const result = dateRangeSchema.safeParse({
    from: "2026-02-01T00:00:00Z",
    to: "2026-01-01T00:00:00Z",
  });
  assertEquals(result.success, false);
});

Deno.test("parseJsonBody returns {} for an empty body", async () => {
  const request = new Request("https://example.com", {
    method: "POST",
    body: "",
  });
  const result = await parseJsonBody(request);
  assertEquals(result, {});
});

Deno.test("parseJsonBody throws ValidationError for malformed JSON", async () => {
  const request = new Request("https://example.com", {
    method: "POST",
    body: "{not json",
  });
  await assertRejects(() => parseJsonBody(request), ValidationError);
});
