// load-tests/lib/common.js
//
// Shared helpers for every scenario script -- one place to change the auth
// header shape, base URL resolution, or account-pool loading logic rather
// than duplicating it per script.

import { SharedArray } from "k6/data";

export const BASE_URL = __ENV.BASE_URL || "http://localhost:54321/functions/v1";
export const ANON_KEY = __ENV.SUPABASE_ANON_KEY || "";

// Loaded once and shared read-only across all VUs (k6's SharedArray avoids
// each virtual user re-parsing the file). Expects an array of
// { userId, jwt } objects -- pre-issued session tokens for seeded test
// accounts, not credentials to log in with per-iteration (login itself is
// its own scenario, k6-auth.js, not a setup step every other scenario
// should pay for too).
export const testAccounts = new SharedArray("test accounts", function () {
  const path = __ENV.TEST_ACCOUNT_POOL || "./seed/test-accounts.json";
  try {
    return JSON.parse(open(path));
  } catch (_err) {
    // Fails loudly at scenario start (via the check in each script), not
    // silently with zero-VU no-op iterations.
    return [];
  }
});

export function pickAccount() {
  if (testAccounts.length === 0) {
    throw new Error(
      "No test accounts loaded -- set TEST_ACCOUNT_POOL to a real seed file before running.",
    );
  }
  return testAccounts[Math.floor(Math.random() * testAccounts.length)];
}

export function authHeaders(jwt) {
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${jwt}`,
    "apikey": ANON_KEY,
  };
}

export function newIdempotencyKey() {
  // crypto.randomUUID() is available in k6's JS runtime (goja + polyfill).
  return crypto.randomUUID();
}
