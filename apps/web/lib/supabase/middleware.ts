import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { clientEnv } from "@/lib/env";
import type { Database } from "@/lib/supabase/types";
import { isSessionMfaVerifiedEdge } from "@/lib/auth/session-registry-edge";

/**
 * Refreshes the Supabase session cookie on every request and returns both
 * the (possibly updated) response and the resolved user, so middleware.ts
 * can make routing decisions without a second round-trip.
 *
 * Also resolves `mfaSatisfied` (Phase 3C independent-review finding):
 * whether THIS session has actually completed MFA, for any account that has
 * a verified TOTP factor enrolled. Computed here, in the one place
 * middleware already resolves the session, rather than as a second
 * middleware-level check, per this phase's "extend, don't duplicate,
 * session validation" instruction. `true` for accounts with no MFA
 * enrolled (nothing to satisfy) or a real aal2 session (TOTP-verified);
 * falls back to the migration-0074 user_sessions.mfa_verified_at marker for
 * a login completed via a recovery code, which GoTrue's own aal2 can never
 * reflect.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // IMPORTANT: do not remove this call. It refreshes the auth token and is
  // what makes session expiry/refresh work transparently across requests.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { response, user, mfaSatisfied: true };
  }

  const { data: factorsData } = await supabase.auth.mfa.listFactors();
  const hasMfaEnrolled = (factorsData?.totp ?? []).some((f) => f.status === "verified");

  if (!hasMfaEnrolled) {
    return { response, user, mfaSatisfied: true };
  }

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

  if (aal?.currentLevel === "aal2") {
    return { response, user, mfaSatisfied: true };
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  const mfaSatisfied = session ? await isSessionMfaVerifiedEdge(session.refresh_token) : false;

  return { response, user, mfaSatisfied };
}
