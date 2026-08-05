// supabase/functions/_shared/permissions/index.ts

import { AuthorizationError } from "../errors/index.ts";
import {
  isAdministrator,
  isModerator,
  isSupportStaff,
  isVerified,
} from "../auth/roles.ts";
import type { UserProfile } from "../auth/session.ts";
import { assertAccountActive } from "../auth/session.ts";

/**
 * Each function below both checks a condition AND asserts the account is
 * active — an inactive (suspended/closed) moderator, for instance, should
 * not retain moderator privileges just because their `role` column hasn't
 * been changed (Business Rules §2 suspension consequences apply
 * regardless of role).
 */

export function requirePlayer(profile: UserProfile): void {
  assertAccountActive(profile);
}

export function requireVerifiedPlayer(profile: UserProfile): void {
  assertAccountActive(profile);
  if (!isVerified(profile)) {
    throw new AuthorizationError(
      "This action requires a verified (KYC-complete) account.",
    );
  }
}

export function requireModerator(profile: UserProfile): void {
  assertAccountActive(profile);
  if (!isModerator(profile)) {
    throw new AuthorizationError(
      "This action requires moderator or administrator privileges.",
    );
  }
}

export function requireAdministrator(profile: UserProfile): void {
  assertAccountActive(profile);
  if (!isAdministrator(profile)) {
    throw new AuthorizationError(
      "This action requires administrator privileges.",
    );
  }
}

export function requireSupportStaff(profile: UserProfile): void {
  assertAccountActive(profile);
  if (!isSupportStaff(profile)) {
    throw new AuthorizationError(
      "This action requires support or administrator privileges.",
    );
  }
}

/**
 * "Service Role" permission level: satisfied by using
 * database/client.ts's getServiceRoleClient() and never routing that call
 * through user-facing JWT verification at all — there is no profile to
 * check because the caller isn't a user, it's the platform itself. Any
 * Edge Function that should ONLY ever be invoked by another trusted
 * service (e.g. a pg_cron-triggered job) should verify a shared secret
 * (security/signed-requests.ts) instead of a user JWT, exactly as
 * STORE-001's storage-cleanup function already does.
 *
 * "Future API Client" permission level: intentionally unimplemented. See
 * auth/roles.ts's comment — it needs a schema (API keys/OAuth clients) that
 * doesn't exist yet. A function requiring this level today should just use
 * requireAdministrator or a signed-request check as an interim measure and
 * flag the gap, not silently allow unauthenticated access.
 */
