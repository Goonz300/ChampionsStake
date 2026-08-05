// supabase/functions/_shared/auth/jwt.ts

import { AuthenticationError } from "../errors/index.ts";
import { getServiceRoleClient } from "../database/client.ts";

export interface AuthenticatedUser {
  id: string;
  email: string | null;
  jwt: string;
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

  return { id: data.user.id, email: data.user.email ?? null, jwt };
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
