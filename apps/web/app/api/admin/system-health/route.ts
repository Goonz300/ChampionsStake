import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireRoleForRoute, isAuthError } from "@/lib/authorization/require-role";
import { invokeEdgeFunctionAsUser, isErrorResponse } from "@/lib/authorization/edge-function-proxy";

/**
 * GET /api/admin/system-health -- explicit proxy to the existing
 * admin-system-health Edge Function (ADMIN-001), which also serves
 * dashboard/analytics reads via ?view=. Read-only; no audit logging (this
 * codebase's established precedent: read-only admin dashboard/analytics
 * views are not audited, only mutations are).
 */

const getQuerySchema = z.object({
  view: z
    .enum([
      "health",
      "dashboard",
      "user_growth",
      "challenge_volume",
      "tournament_volume",
      "revenue",
      "escrow_stats",
      "retention",
      "disputes",
    ])
    .default("health"),
  days: z.coerce.number().int().positive().max(365).default(30),
});

export async function GET(request: NextRequest) {
  const authResult = await requireRoleForRoute("is_admin");
  if (isAuthError(authResult)) return authResult.errorResponse;
  const { supabase, accessToken } = authResult;

  const parsed = getQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams.entries()),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message } },
      { status: 400 },
    );
  }

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(parsed.data)) {
    if (value !== undefined) query.set(key, String(value));
  }

  const result = await invokeEdgeFunctionAsUser(
    supabase,
    accessToken,
    `admin-system-health?${query}`,
    { method: "GET" },
  );
  if (isErrorResponse(result)) return result.errorResponse;

  return NextResponse.json({ data: result.data });
}
