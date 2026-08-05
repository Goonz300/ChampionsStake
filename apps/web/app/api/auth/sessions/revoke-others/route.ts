import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { revokeOtherSessions } from "@/lib/auth/session-registry";

/**
 * POST /api/auth/sessions/revoke-others — signs out every session except
 * the caller's current one (Phase 3 Architecture Rev. 2, §8/§11).
 *
 * This is the honest capability GoTrue actually offers
 * (auth.signOut({scope:"others"})) — there is no true per-session revoke
 * by id at any layer of this stack (app code or GoTrue itself), which is
 * why this endpoint has no [id] segment: the shape matches the real
 * capability rather than promising one that doesn't exist.
 *
 * Uses the caller's own RLS-respecting client for signOut (must run on the
 * client already holding the user's own session — service-role has no
 * "current session" to act on) and service-role for the shadow-registry
 * write, since 0018 grants no client write policy at all on
 * user_sessions — filtered explicitly by user_id and the current session's
 * own token hash, both required since service-role bypasses RLS entirely.
 */
export async function POST() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: { code: "AUTH_INVALID_CREDENTIALS", message: "Not authenticated." } },
      { status: 401 },
    );
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return NextResponse.json(
      { error: { code: "AUTH_INVALID_CREDENTIALS", message: "Not authenticated." } },
      { status: 401 },
    );
  }

  const { error: signOutError } = await supabase.auth.signOut({ scope: "others" });

  if (signOutError) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to revoke other sessions." } },
      { status: 500 },
    );
  }

  const { count, error: revokeError } = await revokeOtherSessions(user.id, session.refresh_token);

  if (revokeError) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to revoke other sessions." } },
      { status: 500 },
    );
  }

  return NextResponse.json({ data: { revoked_count: count } });
}
