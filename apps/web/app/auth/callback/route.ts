import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /auth/callback — the redirect target for every Supabase email link
 * (email verification, password recovery, magic link). Exchanges the `code`
 * query param for a session, then forwards to whatever page the caller
 * requested via `next` (defaulted sensibly per link type by the routes that
 * generated the link — see register/route.ts and forgot-password/route.ts).
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (!code) {
    return NextResponse.redirect(`${origin}/session-expired`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    // Distinguish "already verified" from "genuinely expired" where possible;
    // Supabase's error message is the most reliable signal available here.
    if (error.message.toLowerCase().includes("already")) {
      return NextResponse.redirect(`${origin}/login?message=already_verified`);
    }
    return NextResponse.redirect(`${origin}/session-expired`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
