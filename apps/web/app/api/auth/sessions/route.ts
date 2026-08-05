import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { listSessionsForUser } from "@/lib/auth/session-registry";

/**
 * GET /api/auth/sessions — lists the caller's own sessions, active and
 * historical (Phase 3 Architecture Rev. 2, §8/§11/§12).
 *
 * RLS-respecting client only, never service-role: 0018's
 * user_sessions_select_self_or_admin policy already scopes this to the
 * caller's own rows at the database layer, which is a requirement here,
 * not a preference — a forgotten application-level filter still can't
 * leak another user's sessions.
 */
export async function GET() {
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

  const { data, error } = await listSessionsForUser(supabase, session?.refresh_token);

  if (error) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to load sessions." } },
      { status: 500 },
    );
  }

  return NextResponse.json({ data });
}
