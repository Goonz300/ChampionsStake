import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { revokeSessionByToken } from "@/lib/auth/session-registry";

/**
 * POST /api/auth/logout — single-session logout (Business Rules: current
 * device only). See /api/auth/logout-all for every-device logout.
 */
export async function POST() {
  const supabase = await createClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (session?.refresh_token) {
    await revokeSessionByToken(session.refresh_token);
  }

  await supabase.auth.signOut({ scope: "local" });

  return NextResponse.json({ data: { logged_out: true } });
}
