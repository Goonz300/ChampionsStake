import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

export interface AuthorizedCaller {
  supabase: SupabaseClient<Database>;
  user: User;
  accessToken: string;
}

/**
 * Authenticates the caller and checks a single fixed role requirement via
 * the canonical is_admin/is_moderator RPC -- the SAME functions RLS
 * policies and middleware.ts already call (migration 0016), not a
 * hand-rolled re-check. This is deliberate defense-in-depth, not
 * duplicated authorization: the Edge Function this route will go on to
 * call performs its own requireAdministrator/requireModerator check
 * regardless, using the SAME underlying profiles row (that check remains
 * authoritative) -- doing it here too means an unauthorized caller gets a
 * clean, local 403 without spending an Edge Function invocation, and the
 * route still has something to report as "authorization" in its own right
 * per this phase's requirements.
 *
 * Not used by /api/moderation/appeals, whose actions have genuinely
 * different authorization per action (any dispute participant may file;
 * only an administrator may assign-reviewer/decide) -- there is no single
 * role this helper could check that would be correct for the whole route,
 * so that route authenticates the caller and leaves the per-action
 * authorization entirely to moderator-appeal's own existing, correct logic
 * rather than re-deriving a rule here that would risk drifting from it.
 */
export async function requireRoleForRoute(
  rpcName: "is_admin" | "is_moderator",
): Promise<AuthorizedCaller | { errorResponse: NextResponse }> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      errorResponse: NextResponse.json(
        { error: { code: "AUTH_INVALID_CREDENTIALS", message: "Not authenticated." } },
        { status: 401 },
      ),
    };
  }

  const { data: allowed } = await supabase.rpc(rpcName, {});

  if (!allowed) {
    return {
      errorResponse: NextResponse.json(
        { error: { code: "FORBIDDEN", message: "You do not have access to this resource." } },
        { status: 403 },
      ),
    };
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return {
      errorResponse: NextResponse.json(
        { error: { code: "AUTH_INVALID_CREDENTIALS", message: "Not authenticated." } },
        { status: 401 },
      ),
    };
  }

  return { supabase, user, accessToken: session.access_token };
}

/** Type guard narrowing requireRoleForRoute's union result. */
export function isAuthError(
  result: AuthorizedCaller | { errorResponse: NextResponse },
): result is { errorResponse: NextResponse } {
  return "errorResponse" in result;
}

/**
 * Authenticates the caller without checking any fixed role -- for routes
 * whose authorization is genuinely per-action rather than per-route (e.g.
 * /api/moderation/appeals: any dispute participant may file, but only an
 * administrator may assign a reviewer or decide). The Edge Function this
 * route forwards to performs the real, per-action authorization check;
 * this only confirms the caller is a known, authenticated user.
 */
export async function requireAuthenticatedCaller(): Promise<
  AuthorizedCaller | { errorResponse: NextResponse }
> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      errorResponse: NextResponse.json(
        { error: { code: "AUTH_INVALID_CREDENTIALS", message: "Not authenticated." } },
        { status: 401 },
      ),
    };
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return {
      errorResponse: NextResponse.json(
        { error: { code: "AUTH_INVALID_CREDENTIALS", message: "Not authenticated." } },
        { status: 401 },
      ),
    };
  }

  return { supabase, user, accessToken: session.access_token };
}
