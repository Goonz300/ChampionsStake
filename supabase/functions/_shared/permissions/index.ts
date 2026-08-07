// supabase/functions/_shared/permissions/index.ts

import { AuthorizationError } from "../errors/index.ts";
import {
  isAdministrator,
  isModerator,
  isOrganizer,
  isSupportStaff,
  isVerified,
} from "../auth/roles.ts";
import type { UserProfile } from "../auth/session.ts";
import { assertAccountActive } from "../auth/session.ts";
import type { AuthenticatedUser } from "../auth/jwt.ts";
import { getUserScopedClient } from "../database/client.ts";

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

export function requireOrganizer(profile: UserProfile): void {
  assertAccountActive(profile);
  if (!isOrganizer(profile)) {
    throw new AuthorizationError(
      "This action requires organizer or administrator privileges.",
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
 * Session-assurance check, distinct from the role/profile checks above --
 * takes the AuthenticatedUser (the JWT-derived object), not a UserProfile,
 * since AAL is a property of the SESSION, not the account. Phase 6:
 * withdrawal-service.ts had no MFA/AAL2 enforcement anywhere in the Edge
 * Function layer (verified by grep before adding this) -- MFA enrollment/
 * verification has existed since Phase 3C, but every check of it lived
 * entirely in apps/web's own routes, never reaching the money-moving Edge
 * Functions a stolen aal1-only session token could otherwise call directly.
 *
 * Only enforces aal2 if the account actually HAS a verified MFA factor —
 * MFA is opt-in (Phase 3C), so unconditionally requiring aal2 would lock
 * every non-MFA account out of withdrawing entirely, which is not this
 * account's own security posture to force. Reuses the exact same
 * `supabase.auth.mfa.listFactors()` call (on a client scoped to the
 * caller's own JWT, via getUserScopedClient — not the service-role client,
 * matching apps/web/app/api/auth/login/route.ts's identical, already-proven
 * pattern for the same check) that already gates this in the web app, so
 * there is exactly one way this codebase determines "is MFA enrolled,"
 * not a second, parallel one.
 */
export async function requireAal2IfMfaEnrolled(
  user: AuthenticatedUser,
): Promise<void> {
  const supabase = getUserScopedClient(user.jwt);
  const { data } = await supabase.auth.mfa.listFactors();
  const hasVerifiedFactor = data?.totp.some((f) => f.status === "verified") ??
    false;

  if (hasVerifiedFactor && user.aal !== "aal2") {
    throw new AuthorizationError(
      "This account has multi-factor authentication enabled — please re-verify before withdrawing.",
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
