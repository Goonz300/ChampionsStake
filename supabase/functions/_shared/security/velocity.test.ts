// Run with: deno test supabase/functions/_shared/security/velocity.test.ts
//
// checkVelocity's early-return path (count <= maxCount) is pure -- no
// database call happens at all -- so it's fully testable without a live
// connection. The exceeded path necessarily reaches for the database (to
// dedupe against an already-open flag); this test environment has no live
// Postgres connection, so that path is verified only to the extent
// possible offline (mirrors _wallet/ledger.test.ts's convention).

import { assertEquals } from "@std/assert";
import { checkVelocity } from "./velocity.ts";

Deno.test("checkVelocity does not flag or touch the database when count is within the limit", async () => {
  const result = await checkVelocity({
    userId: "11111111-1111-1111-1111-111111111111",
    signal: "challenge_creation",
    count: 5,
    maxCount: 10,
    windowSeconds: 60,
  });
  assertEquals(result, { exceeded: false });
});

Deno.test("checkVelocity does not flag when count equals maxCount (boundary, not yet over)", async () => {
  const result = await checkVelocity({
    userId: "11111111-1111-1111-1111-111111111111",
    signal: "withdrawal",
    count: 3,
    maxCount: 3,
    windowSeconds: 60,
  });
  assertEquals(result, { exceeded: false });
});
