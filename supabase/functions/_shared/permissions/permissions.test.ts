// Run with: deno test supabase/functions/_shared/permissions/permissions.test.ts
import { assertThrows } from "@std/assert";
import {
  requireAdministrator,
  requireModerator,
  requirePlayer,
  requireSupportStaff,
  requireVerifiedPlayer,
} from "./index.ts";
import { AuthenticationError, AuthorizationError } from "../errors/index.ts";
import type { UserProfile } from "../auth/session.ts";

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

Deno.test("requirePlayer passes for an active account", () => {
  requirePlayer(makeProfile()); // should not throw
});

Deno.test("requirePlayer throws for a suspended account regardless of role", () => {
  assertThrows(
    () =>
      requirePlayer(
        makeProfile({ status: "suspended", role: "administrator" }),
      ),
    AuthenticationError,
  );
});

Deno.test("requireVerifiedPlayer throws if KYC is not verified", () => {
  assertThrows(
    () => requireVerifiedPlayer(makeProfile({ kyc_status: "pending" })),
    AuthorizationError,
  );
});

Deno.test("requireVerifiedPlayer passes when KYC is verified and active", () => {
  requireVerifiedPlayer(makeProfile({ kyc_status: "verified" })); // should not throw
});

Deno.test("requireModerator rejects a plain player", () => {
  assertThrows(
    () => requireModerator(makeProfile({ role: "player" })),
    AuthorizationError,
  );
});

Deno.test("requireModerator accepts a moderator", () => {
  requireModerator(makeProfile({ role: "moderator" })); // should not throw
});

Deno.test("requireModerator accepts an administrator (superset)", () => {
  requireModerator(makeProfile({ role: "administrator" })); // should not throw
});

Deno.test("requireAdministrator rejects a moderator", () => {
  assertThrows(
    () => requireAdministrator(makeProfile({ role: "moderator" })),
    AuthorizationError,
  );
});

Deno.test("requireSupportStaff accepts support and administrator, rejects player/moderator", () => {
  requireSupportStaff(makeProfile({ role: "support" }));
  requireSupportStaff(makeProfile({ role: "administrator" }));
  assertThrows(
    () => requireSupportStaff(makeProfile({ role: "player" })),
    AuthorizationError,
  );
  assertThrows(
    () => requireSupportStaff(makeProfile({ role: "moderator" })),
    AuthorizationError,
  );
});

Deno.test("a closed account is rejected even at the requirePlayer level", () => {
  assertThrows(
    () => requirePlayer(makeProfile({ status: "closed" })),
    AuthenticationError,
  );
});
