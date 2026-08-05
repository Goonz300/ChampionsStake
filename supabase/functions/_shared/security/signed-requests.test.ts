// Run with: deno test supabase/functions/_shared/security/signed-requests.test.ts
import { assertEquals, assertRejects } from "@std/assert";
import { signPayload, verifyHmacSignature } from "./signed-requests.ts";
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
