// supabase/functions/_shared/auth/session.ts

import { getServiceRoleClient } from "../database/client.ts";
import { AuthenticationError } from "../errors/index.ts";
import type { AuthenticatedUser } from "./jwt.ts";

export interface UserProfile {
  id: string;
  display_name: string;
  role: "player" | "moderator" | "administrator" | "support" | "organizer";
  status: "unverified" | "active" | "suspended" | "closed";
  kyc_status: "unverified" | "pending" | "verified" | "rejected";
  trust_score: number;
  sessions_invalidated_at: string | null;
}

/**
 * Loads the full profile row for an authenticated user. Uses the
 * service-role client deliberately (not the user's own JWT-scoped client),
 * since this is called from framework middleware BEFORE we know whether
 * this user is even allowed to read their own row under every possible RLS
 * policy edge case — the profile lookup itself is not the authorization
 * decision, it's an input to one.
 */
export async function loadUserProfile(
  user: AuthenticatedUser,
): Promise<UserProfile> {
  const supabase = getServiceRoleClient();

  const { data, error } = await supabase
    .from("profiles")
    .select(
      "id, display_name, role, status, kyc_status, trust_score, sessions_invalidated_at",
    )
    .eq("id", user.id)
    .single();

  if (error || !data) {
    throw new AuthenticationError(
      "No profile found for the authenticated user.",
    );
  }

  return data as UserProfile;
}

export function assertAccountActive(profile: UserProfile): void {
  if (profile.status !== "active") {
    throw new AuthenticationError(
      `Account status is "${profile.status}", not active.`,
    );
  }
}

/**
 * Rejects a JWT issued before the user's most recent logout-all
 * (profiles.sessions_invalidated_at, migration 0071) — closes the window
 * where an already-issued, still-unexpired access token would otherwise
 * remain valid after the user explicitly revoked every session (Phase 3
 * Architecture Rev. 2, §4). `sessions_invalidated_at` piggybacks the
 * profile row loadUserProfile already fetches on every authenticated
 * request, so this check adds no new query.
 */
export function assertSessionNotInvalidated(
  user: AuthenticatedUser,
  profile: UserProfile,
): void {
  if (!profile.sessions_invalidated_at) return;

  const invalidatedAtSeconds = Math.floor(
    new Date(profile.sessions_invalidated_at).getTime() / 1000,
  );

  if (user.iat < invalidatedAtSeconds) {
    throw new AuthenticationError(
      "Session was revoked by a subsequent logout-all; please sign in again.",
    );
  }
}
