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
  "/api/health", // PROD-001: external uptime monitors cannot authenticate — must never be gated
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
  if (isAdminPath(pathname)) {
    const roleClient = createServerClient<Database>(
      clientEnv.NEXT_PUBLIC_SUPABASE_URL,
      clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { cookies: { getAll: () => request.cookies.getAll(), setAll: () => {} } },
    );

    const { data: profile } = await roleClient
      .from("profiles")
      .select("role, status")
      .eq("id", user.id)
      .maybeSingle();

    const role = profile?.role;
    const status = profile?.status;

    if (status !== "active") {
      const url = request.nextUrl.clone();
      url.pathname = "/access-denied";
      return NextResponse.redirect(url);
    }

    const allowedForModeration = role === "moderator" || role === "administrator";
    const allowedForAdmin = role === "administrator";

    if (isModerationPath(pathname) ? !allowedForModeration : !allowedForAdmin) {
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
