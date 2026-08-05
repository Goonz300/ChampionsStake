import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { listDevicesForUser } from "@/lib/auth/device";

/**
 * GET /api/auth/devices — lists the caller's own known devices (Phase 3
 * Architecture Rev. 2, §8/§11/§12).
 *
 * RLS-respecting client only, never service-role: 0018's
 * devices_select_self_or_staff policy already scopes this to the caller's
 * own rows at the database layer, which is a requirement here, not a
 * preference — a forgotten application-level filter still can't leak
 * another user's devices.
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

  const { data, error } = await listDevicesForUser(supabase);

  if (error) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to load devices." } },
      { status: 500 },
    );
  }

  return NextResponse.json({ data });
}
