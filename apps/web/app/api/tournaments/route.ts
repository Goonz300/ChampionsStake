import { NextResponse, type NextRequest } from "next/server";
import { isAuthError, requireAuthenticatedCaller } from "@/lib/authorization/require-role";
import { invokeEdgeFunctionAsUser, isErrorResponse } from "@/lib/authorization/edge-function-proxy";

/**
 * GET/POST /api/tournaments -- proxy to tournament-browse (list/bracket/
 * standings/participants/match_timeline/activity/ics) and tournament-create.
 * Query/body are forwarded as-is rather than re-declared as a second zod
 * schema here: tournament-browse/tournament-create already validate their
 * own input, and this route's view/action surface is wide enough
 * (7 GET views) that duplicating every one of those schemas here would be
 * exactly the kind of drift-prone duplication this codebase's own
 * conventions avoid -- requireAuthenticatedCaller (not requireRoleForRoute)
 * matches this deliberately: authorization is genuinely per-view/per-action
 * in the Edge Function itself (some views are public, tournament-create
 * requires organizer/admin), the same reasoning documented on
 * requireAuthenticatedCaller for /api/moderation/appeals.
 */
export async function GET(request: NextRequest) {
  const authResult = await requireAuthenticatedCaller();
  if (isAuthError(authResult)) return authResult.errorResponse;
  const { supabase, accessToken } = authResult;

  const query = request.nextUrl.searchParams.toString();

  if (request.nextUrl.searchParams.get("view") === "ics") {
    const { data, error } = await supabase.functions.invoke(`tournament-browse?${query}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (error) {
      return NextResponse.json(
        { error: { code: "INTERNAL_ERROR", message: "Failed to generate calendar feed." } },
        { status: 502 },
      );
    }
    return new Response(data as string, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": "attachment; filename=tournament.ics",
      },
    });
  }

  const result = await invokeEdgeFunctionAsUser(
    supabase,
    accessToken,
    `tournament-browse?${query}`,
    { method: "GET" },
  );
  if (isErrorResponse(result)) return result.errorResponse;
  return NextResponse.json({ data: result.data });
}

export async function POST(request: NextRequest) {
  const authResult = await requireAuthenticatedCaller();
  if (isAuthError(authResult)) return authResult.errorResponse;
  const { supabase, accessToken } = authResult;

  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid JSON body." } },
      { status: 400 },
    );
  }

  const result = await invokeEdgeFunctionAsUser(supabase, accessToken, "tournament-create", {
    method: "POST",
    body,
  });
  if (isErrorResponse(result)) return result.errorResponse;
  return NextResponse.json({ data: result.data }, { status: 201 });
}
