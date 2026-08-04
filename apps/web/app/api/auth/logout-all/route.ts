import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { revokeAllSessionsForUser } from "@/lib/auth/session-registry";

/**
 * POST /api/auth/logout-all — revokes every session for the current user
 * across all devices. Uses the Supabase Auth admin API (service_role),
 * since there is no RLS-respecting client method for a global sign-out —
 * this is one of the narrow, justified uses of the service-role client
 * documented in lib/supabase/server.ts.
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

  const adminClient = createServiceRoleClient();
  const { error } = await adminClient.auth.admin.signOut(user.id, "global");

  if (error) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to revoke sessions." } },
      { status: 500 },
    );
  }

  await revokeAllSessionsForUser(user.id);

  return NextResponse.json({ data: { logged_out_all_devices: true } });
}
