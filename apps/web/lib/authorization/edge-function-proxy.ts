import { FunctionsHttpError } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/**
 * Phase 3D: the shared plumbing every /api/admin/* and /api/moderation/*
 * route uses to reach the already-existing admin-* / moderator-* Edge
 * Functions (ADMIN-001/MODERATOR-001) -- these routes are proxies, not a
 * reimplementation. The one rule that matters here: forward the CALLER's
 * own JWT, never the service-role key, so the Edge Function's own
 * requireAdministrator/requireModerator check still runs against the real
 * caller. A route that accidentally used a service-role client to invoke
 * these functions would let every authenticated user bypass the Edge
 * Function's own authorization entirely (confused deputy) -- this helper
 * exists specifically so that mistake can't be made 10 times independently.
 */

export interface EdgeFunctionErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

/**
 * Calls an existing Edge Function as the given user, forwarding their own
 * access token. `functionPath` may include a query string (e.g.
 * "admin-users?view=summary&userId=...") -- supabase-js's functions.invoke
 * has no separate query-param option, so the caller builds the path
 * itself, exactly the same way a normal fetch() URL would.
 *
 * Returns the parsed success body on 2xx. On any non-2xx response from the
 * Edge Function, returns a NextResponse that forwards that EXACT status
 * code and {error:{code,message}} body -- the Edge Function's own error is
 * the single source of truth for what went wrong; this proxy never
 * invents a different one.
 */
export async function invokeEdgeFunctionAsUser<T = unknown>(
  supabase: SupabaseClient<Database>,
  accessToken: string,
  functionPath: string,
  options: { method: "GET" | "POST" | "PATCH"; body?: Record<string, unknown> },
): Promise<{ data: T } | { errorResponse: NextResponse }> {
  const { data, error } = await supabase.functions.invoke(functionPath, {
    method: options.method,
    ...(options.body !== undefined ? { body: options.body } : {}),
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!error) {
    return { data: (data as { data: T }).data };
  }

  if (error instanceof FunctionsHttpError) {
    const body = (await error.context.json().catch(() => null)) as EdgeFunctionErrorBody | null;
    return {
      errorResponse: NextResponse.json(
        body ?? { error: { code: "INTERNAL_ERROR", message: "Edge Function request failed." } },
        { status: error.context.status },
      ),
    };
  }

  return {
    errorResponse: NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to reach the Edge Function." } },
      { status: 502 },
    ),
  };
}

/** Type guard narrowing invokeEdgeFunctionAsUser's union result. */
export function isErrorResponse<T>(
  result: { data: T } | { errorResponse: NextResponse },
): result is { errorResponse: NextResponse } {
  return "errorResponse" in result;
}
