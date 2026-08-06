import { createHash } from "node:crypto";
import { createServiceRoleClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/**
 * `user_sessions` (DB-001) is a shadow registry alongside Supabase Auth's own
 * internal session/refresh-token tables. It exists so the product can show a
 * user their own active-session/device history and let them revoke one
 * (Roadmap AUTH-005, Step 9 of this phase) without needing direct access to
 * Supabase's internal auth schema. We never store the raw refresh token —
 * only a SHA-256 hash, purely for correlation (e.g. "does this row still
 * correspond to a live Supabase session"), never for reconstructing it.
 */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function recordSession(
  userId: string,
  refreshToken: string,
  ipAddress: string | null,
  userAgent: string | null,
  expiresAt: Date,
  deviceId: string | null = null,
): Promise<void> {
  const supabase = createServiceRoleClient();

  await supabase.from("user_sessions").insert({
    user_id: userId,
    refresh_token_hash: hashToken(refreshToken),
    ip_address: ipAddress,
    user_agent: userAgent,
    device_id: deviceId,
    expires_at: expiresAt.toISOString(),
  });
}

export async function revokeSessionByToken(refreshToken: string): Promise<void> {
  const supabase = createServiceRoleClient();

  await supabase
    .from("user_sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("refresh_token_hash", hashToken(refreshToken))
    .is("revoked_at", null);
}

export async function revokeAllSessionsForUser(userId: string): Promise<void> {
  const supabase = createServiceRoleClient();

  await supabase
    .from("user_sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("revoked_at", null);
}

/**
 * Sets profiles.sessions_invalidated_at (migration 0071) so any JWT issued
 * before this instant is rejected by _shared/auth/session.ts's
 * assertSessionNotInvalidated, even though it hasn't naturally expired yet
 * — closes the still-live-access-token window revokeAllSessionsForUser's
 * refresh-token revocation above doesn't cover (Phase 3 Architecture Rev.
 * 2, §4). Filtered explicitly by `id = userId`: service-role bypasses RLS
 * entirely, so this filter is the only thing bounding the write to the
 * caller's own row.
 *
 * Unlike revokeAllSessionsForUser (a UI-only shadow-registry write above),
 * this one's result is returned and must be checked by the caller: it is
 * the specific write that closes the live-access-token window, so a
 * caller reporting success without it actually having landed would silently
 * defeat the reason this function exists.
 */
export async function invalidateAllSessionsForUser(
  userId: string,
): Promise<{ error: Error | null }> {
  const supabase = createServiceRoleClient();

  const { error } = await supabase
    .from("profiles")
    .update({ sessions_invalidated_at: new Date().toISOString() })
    .eq("id", userId);

  return { error };
}

/**
 * Marks the current session (matched by refresh_token_hash, migration 0074)
 * as having completed login via a recovery code -- the one login-completion
 * path GoTrue's own aal2 cannot represent, since GoTrue has no concept of
 * recovery codes. Called only from /api/auth/mfa/recovery-codes/verify.
 */
export async function markSessionMfaVerified(refreshToken: string): Promise<void> {
  const supabase = createServiceRoleClient();

  await supabase
    .from("user_sessions")
    .update({ mfa_verified_at: new Date().toISOString() })
    .eq("refresh_token_hash", hashToken(refreshToken));
}

export interface SessionListItem {
  id: string;
  device_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  is_current: boolean;
}

/**
 * Lists the caller's own sessions (both active and revoked/expired,
 * newest-created first) -- Phase 3B's "active sessions" and "session
 * history" are the same underlying data, distinguished only by whether
 * revoked_at/expires_at have passed, so one query serves both without a
 * second endpoint or new schema. Takes the caller's own RLS-respecting
 * client, not service-role -- 0018's user_sessions_select_self_or_admin
 * policy already scopes this to the caller's own rows at the database
 * layer, which is a requirement here, not a preference (Phase 3
 * Architecture Rev. 2, §11): a forgotten filter still can't leak another
 * user's sessions.
 *
 * currentRefreshToken is optional and, when supplied, is hashed with the
 * same private hashToken() used everywhere else in this file to mark
 * is_current on the matching row -- the "current session indicator"
 * Milestone 2 requires, computed here rather than duplicating the hashing
 * logic in a caller.
 */
export async function listSessionsForUser(
  supabase: SupabaseClient<Database>,
  currentRefreshToken?: string,
): Promise<{ data: SessionListItem[]; error: Error | null }> {
  const { data, error } = await supabase
    .from("user_sessions")
    .select(
      "id, device_id, ip_address, user_agent, created_at, expires_at, revoked_at, refresh_token_hash",
    )
    .order("created_at", { ascending: false });

  const currentHash = currentRefreshToken ? hashToken(currentRefreshToken) : null;

  const items: SessionListItem[] = (data ?? []).map(({ refresh_token_hash, ...row }) => ({
    ...row,
    is_current: currentHash !== null && refresh_token_hash === currentHash,
  }));

  return { data: items, error };
}

/**
 * Revokes every not-yet-revoked session for the user EXCEPT the one whose
 * refresh token is currentRefreshToken -- the shadow-registry counterpart
 * to auth.signOut({scope:"others"}) (Phase 3 Architecture Rev. 2, §8),
 * which is the actual GoTrue-side capability: there is no true per-session
 * revoke, only "everything but the current session." Filtering by the
 * current token's own hash (rather than looking up its row id first) is
 * both simpler and exactly as precise, since refresh_token_hash is already
 * this table's natural per-session key.
 */
export async function revokeOtherSessions(
  userId: string,
  currentRefreshToken: string,
): Promise<{ count: number; error: Error | null }> {
  const supabase = createServiceRoleClient();

  const { error, count } = await supabase
    .from("user_sessions")
    .update({ revoked_at: new Date().toISOString() }, { count: "exact" })
    .eq("user_id", userId)
    .neq("refresh_token_hash", hashToken(currentRefreshToken))
    .is("revoked_at", null);

  return { count: count ?? 0, error };
}
