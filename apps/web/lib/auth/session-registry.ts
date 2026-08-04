import { createHash } from "node:crypto";
import { createServiceRoleClient } from "@/lib/supabase/server";

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
): Promise<void> {
  const supabase = createServiceRoleClient();

  await supabase.from("user_sessions").insert({
    user_id: userId,
    refresh_token_hash: hashToken(refreshToken),
    ip_address: ipAddress,
    user_agent: userAgent,
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
