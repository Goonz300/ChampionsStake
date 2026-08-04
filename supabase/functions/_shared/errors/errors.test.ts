// Run with: deno test supabase/functions/_shared/errors/errors.test.ts
import { assertEquals, assertInstanceOf } from "jsr:@std/assert@1";
import {
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  InternalServerError,
  toEdgeFunctionError,
  EdgeFunctionError,
} from "./index.ts";

Deno.test("ValidationError has code VALIDATION_ERROR and status 400", () => {
  const err = new ValidationError("bad input");
  assertEquals(err.code, "VALIDATION_ERROR");
  assertEquals(err.httpStatus, 400);
});

Deno.test("AuthenticationError has status 401", () => {
  assertEquals(new AuthenticationError("no token").httpStatus, 401);
});

Deno.test("AuthorizationError has status 403", () => {
  assertEquals(new AuthorizationError("nope").httpStatus, 403);
});

Deno.test("NotFoundError has status 404", () => {
  assertEquals(new NotFoundError("missing").httpStatus, 404);
});

Deno.test("ConflictError has status 409", () => {
  assertEquals(new ConflictError("conflict").httpStatus, 409);
});

Deno.test("RateLimitError carries retryAfterSeconds and status 429", () => {
  const err = new RateLimitError("slow down", 60);
  assertEquals(err.httpStatus, 429);
  assertEquals(err.retryAfterSeconds, 60);
});

Deno.test("toEdgeFunctionError passes through an existing EdgeFunctionError unchanged", () => {
  const original = new ValidationError("x");
  const result = toEdgeFunctionError(original);
  assertEquals(result, original);
});

Deno.test("toEdgeFunctionError wraps a plain Error as InternalServerError", () => {
  const result = toEdgeFunctionError(new Error("boom"));
  assertInstanceOf(result, InternalServerError);
  assertEquals(result.message, "boom");
});

Deno.test("toEdgeFunctionError wraps a non-Error throw as a generic InternalServerError", () => {
  const result = toEdgeFunctionError("some string was thrown");
  assertInstanceOf(result, InternalServerError);
});

Deno.test("toResponseBody produces the standard error envelope shape", () => {
  const err = new ValidationError("bad field", { field: "email" });
  const body = err.toResponseBody();
  assertEquals(body.error.code, "VALIDATION_ERROR");
  assertEquals(body.error.message, "bad field");
  assertEquals((body.error as { details?: unknown }).details, { field: "email" });
});

Deno.test("every declared error subclasses EdgeFunctionError", () => {
  const instances = [
    new ValidationError("x"),
    new AuthenticationError("x"),
    new AuthorizationError("x"),
    new NotFoundError("x"),
    new ConflictError("x"),
    new RateLimitError("x", 1),
    new InternalServerError("x"),
  ];
  for (const instance of instances) {
    assertInstanceOf(instance, EdgeFunctionError);
  }
});
