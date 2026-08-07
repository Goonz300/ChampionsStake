import { NextResponse, type NextRequest } from "next/server";
import { isAuthError, requireAuthenticatedCaller } from "@/lib/authorization/require-role";
import { invokeEdgeFunctionAsUser, isErrorResponse } from "@/lib/authorization/edge-function-proxy";

/** GET/POST /api/tournaments/organize -- proxy to tournament-organize
 * (organizer dashboard, templates, invitations, analytics, scheduling).
 * See app/api/tournaments/route.ts for why query/body are forwarded as-is
 * rather than re-declared here -- same reasoning, same wide view/action
 * surface. */
export async function GET(request: NextRequest) {
  const authResult = await requireAuthenticatedCaller();
  if (isAuthError(authResult)) return authResult.errorResponse;
  const { supabase, accessToken } = authResult;

  const query = request.nextUrl.searchParams.toString();
  const result = await invokeEdgeFunctionAsUser(
    supabase,
    accessToken,
    `tournament-organize?${query}`,
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

  const result = await invokeEdgeFunctionAsUser(supabase, accessToken, "tournament-organize", {
    method: "POST",
    body,
  });
  if (isErrorResponse(result)) return result.errorResponse;
  return NextResponse.json({ data: result.data }, { status: 201 });
}
