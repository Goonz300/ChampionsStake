// Run with: deno test supabase/functions/_shared/security/client-ip.test.ts
import { assertEquals } from "@std/assert";
import { getClientIp } from "./client-ip.ts";

function requestWithHeaders(headers: Record<string, string>): Request {
  return new Request("https://example.com/", { headers });
}

// EDGE_TRUSTED_PROXY_HOPS defaults to 1 (config/index.ts's plain, module-
// load-time computed property -- not a lazy getter, so it can't be varied
// per-test via Deno.env.set after import). All cases below assume the
// default single-hop topology.

Deno.test("getClientIp prefers CF-Connecting-IP over everything else", () => {
  const request = requestWithHeaders({
    "cf-connecting-ip": "203.0.113.5",
    "x-forwarded-for": "198.51.100.1, 10.0.0.1",
    "x-real-ip": "192.0.2.9",
  });
  assertEquals(getClientIp(request), "203.0.113.5");
});

Deno.test("getClientIp trims whitespace on CF-Connecting-IP", () => {
  const request = requestWithHeaders({ "cf-connecting-ip": "  203.0.113.5  " });
  assertEquals(getClientIp(request), "203.0.113.5");
});

Deno.test("getClientIp trusts the last X-Forwarded-For entry (1 trusted hop), not the first (spoofable) one", () => {
  // client-claimed, our-proxy-appended
  const request = requestWithHeaders({
    "x-forwarded-for": "198.51.100.1, 203.0.113.9",
  });
  assertEquals(getClientIp(request), "203.0.113.9");
});

Deno.test("getClientIp handles a single-entry X-Forwarded-For", () => {
  const request = requestWithHeaders({ "x-forwarded-for": "203.0.113.9" });
  assertEquals(getClientIp(request), "203.0.113.9");
});

Deno.test("getClientIp falls back to X-Real-IP when X-Forwarded-For is absent", () => {
  const request = requestWithHeaders({ "x-real-ip": "192.0.2.9" });
  assertEquals(getClientIp(request), "192.0.2.9");
});

Deno.test("getClientIp returns null when no usable header is present", () => {
  const request = requestWithHeaders({});
  assertEquals(getClientIp(request), null);
});

Deno.test("getClientIp ignores an empty X-Forwarded-For and falls through to X-Real-IP", () => {
  const request = requestWithHeaders({
    "x-forwarded-for": "",
    "x-real-ip": "192.0.2.9",
  });
  assertEquals(getClientIp(request), "192.0.2.9");
});
