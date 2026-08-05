import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  invalidateAllSessionsForUser,
  revokeAllSessionsForUser,
} from "@/lib/auth/session-registry";

/**
 * POST /api/auth/logout-all — revokes every session for the current user
 * across all devices.
 *
 * Uses the regular, RLS-respecting client's own auth.signOut({scope:
 * "global"}) — not the Admin API. GoTrueAdminApi.signOut(jwt, scope)'s
 * first argument must be an actual JWT used as the request's bearer token,
 * not a user id; the previous implementation passed user.id there, which
 * fails GoTrue's token parsing on every real invocation (Phase 3
 * Architecture Rev. 2, §3). The regular client's signOut() takes no
 * id/JWT argument at all — it acts on whichever session the client
 * instance already holds via cookies, which is exactly this user's own
 * session, so no service-role client is needed for self-service logout-all.
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

  const { error } = await supabase.auth.signOut({ scope: "global" });

  if (error) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to revoke sessions." } },
      { status: 500 },
    );
  }

  await revokeAllSessionsForUser(user.id);
  await invalidateAllSessionsForUser(user.id);

  return NextResponse.json({ data: { logged_out_all_devices: true } });
}
