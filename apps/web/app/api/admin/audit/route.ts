import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireRoleForRoute, isAuthError } from "@/lib/authorization/require-role";
import { invokeEdgeFunctionAsUser, isErrorResponse } from "@/lib/authorization/edge-function-proxy";

/**
 * GET /api/admin/audit -- explicit proxy to the existing admin-audit Edge
 * Function (ADMIN-001), reading the same audit_logs table every other
 * privileged write in this codebase records to. Read-only, so this route
 * generates no NEW audit entries of its own (searching the audit log is
 * not itself audited, matching this codebase's existing read-only
 * precedent) -- it is, itself, the audit-log consumer.
 */

const getQuerySchema = z.object({
  actorId: z.string().uuid().optional(),
  targetTable: z.string().max(100).optional(),
  targetId: z.string().max(200).optional(),
  action: z.string().max(100).optional(),
  category: z.string().max(50).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
  cursor: z.string().optional(),
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

  const result = await invokeEdgeFunctionAsUser(supabase, accessToken, `admin-audit?${query}`, {
    method: "GET",
  });
  if (isErrorResponse(result)) return result.errorResponse;

  return NextResponse.json({ data: result.data });
}
