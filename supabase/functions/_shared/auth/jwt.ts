// supabase/functions/_shared/auth/jwt.ts

import { AuthenticationError } from "../errors/index.ts";
import { getServiceRoleClient } from "../database/client.ts";

export interface AuthenticatedUser {
  id: string;
  email: string | null;
  jwt: string;
  /**
   * Unix seconds this token was issued (its `iat` claim), decoded from the
   * JWT payload after `getUser` has already verified the token is genuine —
   * never trusted before that. Used by session.ts's assertSessionNotInvalidated
   * to reject a token issued before the user's most recent logout-all
   * (Phase 3 Architecture Rev. 2, §4).
   */
  iat: number;
}

/**
 * Decodes the `iat` claim from an already-base64url-encoded JWT payload.
 * This is NOT signature verification (that remains delegated to
 * supabase.auth.getUser, per the design note below) — it only reads a
 * field from a token verifyRequestJwt has already confirmed is genuine.
 * Exported for unit testing; not otherwise part of this module's public API.
 */
export function decodeJwtIat(jwt: string): number {
  const parts = jwt.split(".");
  if (parts.length !== 3) {
    throw new AuthenticationError(
      "Malformed JWT: expected three dot-separated segments.",
    );
  }

  const base64url = parts[1];
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    base64url.length + ((4 - (base64url.length % 4)) % 4),
    "=",
  );

  let payload: { iat?: unknown };
  try {
    payload = JSON.parse(atob(base64));
  } catch {
    throw new AuthenticationError(
      "Malformed JWT: payload is not valid base64url-encoded JSON.",
    );
  }

  if (typeof payload.iat !== "number") {
    throw new AuthenticationError(
      "Malformed JWT: missing or invalid iat claim.",
    );
  }

  return payload.iat;
}

/**
 * Extracts and verifies the bearer JWT from an incoming request.
 * Verification is delegated to Supabase Auth itself (supabase.auth.getUser)
 * rather than manually decoding/verifying the JWT signature here — Supabase
 * rotates its signing keys, and re-implementing that verification would be
 * exactly the kind of duplicated, easy-to-get-subtly-wrong security code
 * this shared framework exists to prevent.
 */
export async function verifyRequestJwt(
  request: Request,
): Promise<AuthenticatedUser> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new AuthenticationError("Missing or malformed Authorization header.");
  }

  const jwt = authHeader.slice("Bearer ".length);
  const supabase = getServiceRoleClient();

  const { data, error } = await supabase.auth.getUser(jwt);
  if (error || !data.user) {
    throw new AuthenticationError("Invalid or expired token.");
  }

  return {
    id: data.user.id,
    email: data.user.email ?? null,
    jwt,
    iat: decodeJwtIat(jwt),
  };
}

/**
 * Same as verifyRequestJwt, but returns null instead of throwing when no
 * Authorization header is present at all — for endpoints that support both
 * authenticated and anonymous access (e.g. browsing public challenges).
 * A malformed/expired token, as opposed to a missing one, still throws.
 */
export async function verifyOptionalRequestJwt(
  request: Request,
): Promise<AuthenticatedUser | null> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader) return null;
  return await verifyRequestJwt(request);
}
