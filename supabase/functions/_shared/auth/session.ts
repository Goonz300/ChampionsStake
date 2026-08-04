// supabase/functions/_shared/auth/session.ts

import { getServiceRoleClient } from "../database/client.ts";
import { AuthenticationError } from "../errors/index.ts";
import type { AuthenticatedUser } from "./jwt.ts";

export interface UserProfile {
  id: string;
  display_name: string;
  role: "player" | "moderator" | "administrator" | "support";
  status: "unverified" | "active" | "suspended" | "closed";
  kyc_status: "unverified" | "pending" | "verified" | "rejected";
  trust_score: number;
}

/**
 * Loads the full profile row for an authenticated user. Uses the
 * service-role client deliberately (not the user's own JWT-scoped client),
 * since this is called from framework middleware BEFORE we know whether
 * this user is even allowed to read their own row under every possible RLS
 * policy edge case — the profile lookup itself is not the authorization
 * decision, it's an input to one.
 */
export async function loadUserProfile(user: AuthenticatedUser): Promise<UserProfile> {
  const supabase = getServiceRoleClient();

  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, role, status, kyc_status, trust_score")
    .eq("id", user.id)
    .single();

  if (error || !data) {
    throw new AuthenticationError("No profile found for the authenticated user.");
  }

  return data as UserProfile;
}

export function assertAccountActive(profile: UserProfile): void {
  if (profile.status !== "active") {
    throw new AuthenticationError(`Account status is "${profile.status}", not active.`);
  }
}
