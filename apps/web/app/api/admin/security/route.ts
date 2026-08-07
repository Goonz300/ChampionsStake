import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireRoleForRoute, isAuthError } from "@/lib/authorization/require-role";
import { invokeEdgeFunctionAsUser, isErrorResponse } from "@/lib/authorization/edge-function-proxy";

/**
 * GET/POST /api/admin/security -- explicit proxy to the admin-security Edge
 * Function (Phase 5, Layer 16). Same shape as /api/admin/users: named,
 * validated fields only, no generic passthrough. Audit logging happens
 * once, inside _admin/security.ts's unlockAccount and _ai/fraud-detection's
 * reviewFlag -- not duplicated here.
 */

const getQuerySchema = z.object({
  view: z.enum(["locked_accounts", "fraud_flags", "abuse_stats"]).default("abuse_stats"),
  status: z.enum(["open", "reviewed_cleared", "reviewed_confirmed"]).optional(),
  hours: z.coerce
    .number()
    .int()
    .positive()
    .max(24 * 30)
    .default(24),
  limit: z.coerce.number().int().positive().max(200).default(50),
});

const postBodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("unlock_account"), email: z.string().email() }),
  z.object({
    action: z.literal("review_fraud_flag"),
    flagId: z.string().uuid(),
    outcome: z.enum(["reviewed_cleared", "reviewed_confirmed"]),
  }),
]);

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

  const result = await invokeEdgeFunctionAsUser(supabase, accessToken, `admin-security?${query}`, {
    method: "GET",
  });
  if (isErrorResponse(result)) return result.errorResponse;

  return NextResponse.json({ data: result.data });
}

export async function POST(request: NextRequest) {
  const authResult = await requireRoleForRoute("is_admin");
  if (isAuthError(authResult)) return authResult.errorResponse;
  const { supabase, accessToken } = authResult;

  const body = await request.json().catch(() => null);
  const parsed = postBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message } },
      { status: 400 },
    );
  }

  const result = await invokeEdgeFunctionAsUser(supabase, accessToken, "admin-security", {
    method: "POST",
    body: parsed.data,
  });
  if (isErrorResponse(result)) return result.errorResponse;

  return NextResponse.json({ data: result.data });
}
