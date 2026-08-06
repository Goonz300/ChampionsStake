// Run with: deno test supabase/functions/_shared/security/signed-requests.test.ts
import { assertEquals, assertRejects } from "@std/assert";
import {
  signPayload,
  timingSafeEqual,
  verifyHmacSignature,
} from "./signed-requests.ts";
import { AuthenticationError } from "../errors/index.ts";

Deno.test("signPayload produces a verifiable signature", async () => {
  const secret = "test-secret";
  const payload = JSON.stringify({ hello: "world" });

  const signature = await signPayload(payload, secret);
  await verifyHmacSignature(payload, signature, secret); // should not throw
});

Deno.test("verifyHmacSignature rejects a tampered payload", async () => {
  const secret = "test-secret";
  const originalPayload = JSON.stringify({ amount: 100 });
  const signature = await signPayload(originalPayload, secret);

  const tamperedPayload = JSON.stringify({ amount: 999999 });

  await assertRejects(
    () => verifyHmacSignature(tamperedPayload, signature, secret),
    AuthenticationError,
  );
});

Deno.test("verifyHmacSignature rejects a signature made with the wrong secret", async () => {
  const payload = JSON.stringify({ hello: "world" });
  const signature = await signPayload(payload, "secret-a");

  await assertRejects(
    () => verifyHmacSignature(payload, signature, "secret-b"),
    AuthenticationError,
  );
});

Deno.test("signPayload is deterministic for the same input", async () => {
  const secret = "test-secret";
  const payload = "fixed-payload";

  const sigA = await signPayload(payload, secret);
  const sigB = await signPayload(payload, secret);

  assertEquals(sigA, sigB);
});

// Phase 3D: timingSafeEqual was promoted from a private helper to an
// exported primitive so every bearer-token/signature comparison in this
// codebase (scheduled-job shared secrets, storage-cleanup, the Paystack
// webhook signature) can reuse it instead of a plain ===/!==. These tests
// cover its own correctness directly, independent of any one call site.
Deno.test("timingSafeEqual returns true for identical strings", () => {
  assertEquals(
    timingSafeEqual("Bearer secret-value", "Bearer secret-value"),
    true,
  );
});

Deno.test("timingSafeEqual returns false for a single differing character", () => {
  assertEquals(
    timingSafeEqual("Bearer secret-value", "Bearer secret-valuf"),
    false,
  );
});

Deno.test("timingSafeEqual returns false for different-length strings without throwing", () => {
  assertEquals(timingSafeEqual("short", "a-much-longer-string"), false);
});

Deno.test("timingSafeEqual returns false comparing against an empty string", () => {
  assertEquals(timingSafeEqual("non-empty", ""), false);
});

Deno.test("timingSafeEqual returns true for two empty strings", () => {
  assertEquals(timingSafeEqual("", ""), true);
});
