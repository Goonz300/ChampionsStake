import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { createServerClient } from "@supabase/ssr";
import { clientEnv } from "@/lib/env";
import type { Database } from "@/lib/supabase/types";

const AUTH_PAGES = ["/login", "/register", "/forgot-password", "/reset-password"];
const PUBLIC_PREFIXES = [
  "/",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/session-expired",
  "/access-denied",
  "/maintenance",
  "/auth/callback",
  "/terms", // Landing page footer link -- legal pages must stay reachable without an account.
  "/privacy",
  "/cookies",
  "/api/health", // PROD-001: external uptime monitors cannot authenticate — must never be gated
  // PHASE 17 STEP 4 FINDING (P0, confirmed by a real, unauthenticated HTTP
  // POST against a running instance -- every prior phase's auth testing
  // went straight through Supabase's own /auth/v1/token REST API and never
  // once exercised these Next.js routes over HTTP, so this was invisible
  // until now): none of these were in PUBLIC_PREFIXES, so a genuinely
  // logged-out visitor's request to any of them never reached the route
  // handler at all -- middleware's own "!user -> redirect to /login" rule
  // (below) fired first, on the LOGIN route itself. As configured, no new
  // user could register and no existing user could log in through the
  // actual application. reset-password and logout are deliberately NOT
  // listed here -- both require a real (recovery or normal) session to be
  // meaningful, and middleware's existing `!user` check is the correct
  // gate for a request with no session context at all.
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/forgot-password",
  "/api/auth/resend-verification",
  "/api/auth/session", // Designed to answer "am I logged in?" with a clean 401 JSON for a logged-out caller -- must reach its own handler, not be redirected.
  // Phase 12 (Marketplace pipeline): browsing is public, matching the
  // existing challenge-browse Edge Function's own auth:"optional" posture
  // — a signed-out visitor sees open listings, same as today's public
  // challenge browse. /invite/[code] must be reachable pre-auth by
  // definition (a shared link's whole point is a visitor previews it,
  // THEN is asked to log in via /login?redirect_to=/invite/{code} —
  // see docs/MARKETPLACE_ACQUISITION_ARCHITECTURE.md). Accepting a match
  // still requires auth — that's enforced by marketplace-reserve's own
  // auth:"required", not by this page being gated.
  "/marketplace",
  "/invite",
  // Phase 13 (Player Experience): public player profiles mirror
  // player-profile-get's own auth:"optional" posture — a signed-out
  // visitor can view a profile (subject to that profile's own privacy
  // preferences), same reasoning as /marketplace above.
  "/players",
];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

// Phase 3C independent-review finding: reachable by a session that is
// authenticated but has not yet satisfied MFA (see updateSession's
// mfaSatisfied) -- without this allowlist, a not-yet-MFA'd session could
// never reach the very endpoints that let it finish logging in, or sign
// out and start over. Not treated as fully PUBLIC_PREFIXES-public: each of
// these routes still does its own getUser() check and rejects a session
// with no user at all, same as before this change.
const MFA_COMPLETION_PATHS = [
  "/api/auth/mfa/verify",
  "/api/auth/mfa/recovery-codes/verify",
  "/api/auth/logout",
];

export function isMfaCompletionPath(pathname: string): boolean {
  return MFA_COMPLETION_PATHS.some((p) => pathname === p);
}

export function isAdminPath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

export function isModerationPath(pathname: string): boolean {
  return pathname === "/admin/moderation" || pathname.startsWith("/admin/moderation/");
}

export async function middleware(request: NextRequest) {
  const { response, user, mfaSatisfied } = await updateSession(request);
  const { pathname } = request.nextUrl;

  // A session that is authenticated but hasn't satisfied MFA yet (Phase 3C
  // independent-review finding) is treated the same as "not authenticated"
  // for routing purposes below -- login isn't actually complete until MFA
  // is, so it must not unlock protected pages just because a password was
  // correct. The MFA-completion endpoints themselves are exempted so such a
  // session can actually finish (or abandon) that step.
  const pendingMfa = Boolean(user) && !mfaSatisfied && !isMfaCompletionPath(pathname);

  // --- Maintenance mode -----------------------------------------------------
  // Reads the `maintenance_mode` feature flag (if present — absence is
  // treated as "not in maintenance", since the flag is optional and not part
  // of the seed data shipped in DB-001).
  if (pathname !== "/maintenance") {
    const flagClient = createServerClient<Database>(
      clientEnv.NEXT_PUBLIC_SUPABASE_URL,
      clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { cookies: { getAll: () => request.cookies.getAll(), setAll: () => {} } },
    );

    const { data: maintenanceFlag } = await flagClient
      .from("feature_flags")
      .select("enabled")
      .eq("key", "maintenance_mode")
      .maybeSingle();

    if (maintenanceFlag?.enabled) {
      const url = request.nextUrl.clone();
      url.pathname = "/maintenance";
      return NextResponse.redirect(url);
    }
  }

  // --- Authenticated users should not see auth pages ------------------------
  // Excludes a pending-MFA session -- it still needs to reach /login to
  // finish (or restart) the MFA step, not get bounced to /dashboard, which
  // it hasn't actually earned access to yet.
  if (
    user &&
    !pendingMfa &&
    AUTH_PAGES.some((p) => pathname === p || pathname.startsWith(p + "/"))
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  // --- Public paths: nothing further to check -------------------------------
  if (isPublicPath(pathname)) {
    return response;
  }

  // --- Everything else requires authentication (and completed MFA) ----------
  if (!user || pendingMfa) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect_to", pathname);
    return NextResponse.redirect(url);
  }

  // --- Admin / moderator role gating -----------------------------------------
  // Phase 3D independent-review finding: this used to re-derive the
  // moderator/administrator rule inline (role in (...) && status ===
  // 'active'), a second, hand-written copy of exactly what is_admin()/
  // is_moderator() already express in migration 0016 and enforce in every
  // RLS policy. Calling the canonical RPCs here instead means there is
  // exactly one source of truth for "is this user a moderator/admin" --
  // both functions already check `status = 'active'` themselves, so no
  // separate status check is needed on this side.
  if (isAdminPath(pathname)) {
    const roleClient = createServerClient<Database>(
      clientEnv.NEXT_PUBLIC_SUPABASE_URL,
      clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { cookies: { getAll: () => request.cookies.getAll(), setAll: () => {} } },
    );

    const rpcName = isModerationPath(pathname) ? "is_moderator" : "is_admin";
    const { data: allowed } = await roleClient.rpc(rpcName, {});

    if (!allowed) {
      const url = request.nextUrl.clone();
      url.pathname = "/access-denied";
      return NextResponse.redirect(url);
    }
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static, _next/image (Next.js internals)
     * - favicon.ico, and common static file extensions
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
