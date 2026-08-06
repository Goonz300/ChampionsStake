import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireRoleForRoute, isAuthError } from "@/lib/authorization/require-role";
import { invokeEdgeFunctionAsUser, isErrorResponse } from "@/lib/authorization/edge-function-proxy";

/**
 * GET/PATCH /api/admin/feature-flags -- explicit proxy to the existing
 * admin-feature-flags Edge Function (ADMIN-001). The four-eyes
 * dual-approval workflow for requires_dual_approval=true flags stays
 * entirely inside fn_feature_flags_dual_approval_guard (migration 0025) --
 * this route neither knows nor needs to know about it. Toggling is now
 * audited (Phase 3D fix to _admin/feature-flags.ts's toggleFeatureFlag) --
 * not duplicated here.
 */

const patchBodySchema = z.object({ key: z.string().min(1).max(100), enabled: z.boolean() });

export async function GET() {
  const authResult = await requireRoleForRoute("is_admin");
  if (isAuthError(authResult)) return authResult.errorResponse;
  const { supabase, accessToken } = authResult;

  const result = await invokeEdgeFunctionAsUser(supabase, accessToken, "admin-feature-flags", {
    method: "GET",
  });
  if (isErrorResponse(result)) return result.errorResponse;

  return NextResponse.json({ data: result.data });
}

export async function PATCH(request: NextRequest) {
  const authResult = await requireRoleForRoute("is_admin");
  if (isAuthError(authResult)) return authResult.errorResponse;
  const { supabase, accessToken } = authResult;

  const body = await request.json().catch(() => null);
  const parsed = patchBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message } },
      { status: 400 },
    );
  }

  const result = await invokeEdgeFunctionAsUser(supabase, accessToken, "admin-feature-flags", {
    method: "PATCH",
    body: parsed.data,
  });
  if (isErrorResponse(result)) return result.errorResponse;

  return NextResponse.json({ data: result.data });
}
