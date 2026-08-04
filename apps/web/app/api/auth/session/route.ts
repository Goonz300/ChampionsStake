import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/auth/session — lets the frontend gate UI without re-fetching the
 * full profile on every screen (API Spec AUTH-EP-10).
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

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "id, display_name, avatar_url, role, status, kyc_status, trust_score, completion_rate, created_at",
    )
    .eq("id", user.id)
    .single();

  return NextResponse.json({ data: profile });
}
