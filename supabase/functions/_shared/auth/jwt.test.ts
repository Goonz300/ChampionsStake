// Run with: deno test supabase/functions/_shared/auth/jwt.test.ts
import { assertEquals, assertThrows } from "@std/assert";
import { decodeJwtAal, decodeJwtIat } from "./jwt.ts";
import { AuthenticationError } from "../errors/index.ts";

function makeJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const body = btoa(JSON.stringify(payload))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${header}.${body}.fake-signature`;
}

Deno.test("decodeJwtIat extracts the iat claim from a well-formed JWT", () => {
  const jwt = makeJwt({
    sub: "user-1",
    iat: 1_700_000_000,
    exp: 1_700_003_600,
  });
  assertEquals(decodeJwtIat(jwt), 1_700_000_000);
});

Deno.test("decodeJwtIat handles base64url payloads without padding correctly", () => {
  // A payload whose base64 length isn't a multiple of 4 exercises the
  // padEnd() logic explicitly.
  const jwt = makeJwt({ iat: 1 });
  assertEquals(decodeJwtIat(jwt), 1);
});

Deno.test("decodeJwtIat throws AuthenticationError for a token with the wrong segment count", () => {
  assertThrows(
    () => decodeJwtIat("only-one-segment"),
    AuthenticationError,
  );
});

Deno.test("decodeJwtIat throws AuthenticationError for a payload that isn't valid JSON", () => {
  const notJson = btoa("not json at all").replace(/\+/g, "-").replace(
    /\//g,
    "_",
  ).replace(/=+$/, "");
  assertThrows(
    () => decodeJwtIat(`header.${notJson}.sig`),
    AuthenticationError,
  );
});

Deno.test("decodeJwtIat throws AuthenticationError when iat is missing", () => {
  const jwt = makeJwt({ sub: "user-1" });
  assertThrows(
    () => decodeJwtIat(jwt),
    AuthenticationError,
  );
});

Deno.test("decodeJwtIat throws AuthenticationError when iat is not a number", () => {
  const jwt = makeJwt({ iat: "not-a-number" });
  assertThrows(
    () => decodeJwtIat(jwt),
    AuthenticationError,
  );
});

Deno.test("decodeJwtAal extracts the aal claim from a well-formed JWT", () => {
  const jwt = makeJwt({ sub: "user-1", aal: "aal2" });
  assertEquals(decodeJwtAal(jwt), "aal2");
});

Deno.test("decodeJwtAal defaults to aal1 when the claim is absent (older/non-MFA session)", () => {
  const jwt = makeJwt({ sub: "user-1" });
  assertEquals(decodeJwtAal(jwt), "aal1");
});

Deno.test("decodeJwtAal defaults to aal1 when the claim is present but not a string", () => {
  const jwt = makeJwt({ sub: "user-1", aal: 2 });
  assertEquals(decodeJwtAal(jwt), "aal1");
});

Deno.test("decodeJwtAal throws AuthenticationError for a token with the wrong segment count", () => {
  assertThrows(
    () => decodeJwtAal("only-one-segment"),
    AuthenticationError,
  );
});
