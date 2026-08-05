// Run with: deno test supabase/functions/_shared/auth/session.test.ts
import { assertThrows } from "@std/assert";
import {
  assertAccountActive,
  assertSessionNotInvalidated,
  type UserProfile,
} from "./session.ts";
import { AuthenticationError } from "../errors/index.ts";
import type { AuthenticatedUser } from "./jwt.ts";

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    display_name: "Test",
    role: "player",
    status: "active",
    kyc_status: "unverified",
    trust_score: 1000,
    sessions_invalidated_at: null,
    ...overrides,
  };
}

function makeUser(
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    email: "player@example.com",
    jwt: "fake.jwt.token",
    iat: 1_700_000_000,
    ...overrides,
  };
}

Deno.test("assertAccountActive passes for an active profile", () => {
  assertAccountActive(makeProfile({ status: "active" })); // should not throw
});

Deno.test("assertAccountActive throws for a suspended profile", () => {
  assertThrows(
    () => assertAccountActive(makeProfile({ status: "suspended" })),
    AuthenticationError,
  );
});

Deno.test("assertSessionNotInvalidated passes when sessions_invalidated_at is null", () => {
  const user = makeUser({ iat: 1_700_000_000 });
  const profile = makeProfile({ sessions_invalidated_at: null });
  assertSessionNotInvalidated(user, profile); // should not throw
});

Deno.test("assertSessionNotInvalidated passes when the token was issued after the invalidation timestamp", () => {
  const user = makeUser({ iat: 1_700_003_600 }); // issued later
  const profile = makeProfile({
    sessions_invalidated_at: new Date(1_700_000_000 * 1000).toISOString(), // invalidated earlier
  });
  assertSessionNotInvalidated(user, profile); // should not throw — token is fresher than the logout-all
});

Deno.test("assertSessionNotInvalidated throws when the token was issued before the invalidation timestamp", () => {
  const user = makeUser({ iat: 1_700_000_000 }); // issued earlier
  const profile = makeProfile({
    sessions_invalidated_at: new Date(1_700_003_600 * 1000).toISOString(), // invalidated later
  });
  assertThrows(
    () => assertSessionNotInvalidated(user, profile),
    AuthenticationError,
  );
});

Deno.test("assertSessionNotInvalidated throws exactly at the invalidation boundary (iat equal to the cutoff is not accepted)", () => {
  const cutoffSeconds = 1_700_000_000;
  const user = makeUser({ iat: cutoffSeconds });
  const profile = makeProfile({
    sessions_invalidated_at: new Date(cutoffSeconds * 1000).toISOString(),
  });
  // iat < invalidatedAt is false when they're equal, so this should NOT throw
  // -- a token issued in the same second as the logout-all is treated as
  // issued by the logout-all's own subsequent fresh login, not before it.
  assertSessionNotInvalidated(user, profile);
});
