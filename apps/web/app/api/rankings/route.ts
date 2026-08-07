import { NextResponse, type NextRequest } from "next/server";
import { isAuthError, requireAuthenticatedCaller } from "@/lib/authorization/require-role";
import { invokeEdgeFunctionAsUser, isErrorResponse } from "@/lib/authorization/edge-function-proxy";

/** GET /api/rankings -- proxy to ranking-manage (leaderboard, player
 * rating, rating history). Read-only -- ranking-manage has no POST. */
export async function GET(request: NextRequest) {
  const authResult = await requireAuthenticatedCaller();
  if (isAuthError(authResult)) return authResult.errorResponse;
  const { supabase, accessToken } = authResult;

  const query = request.nextUrl.searchParams.toString();
  const result = await invokeEdgeFunctionAsUser(supabase, accessToken, `ranking-manage?${query}`, {
    method: "GET",
  });
  if (isErrorResponse(result)) return result.errorResponse;
  return NextResponse.json({ data: result.data });
}
