import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireRoleForRoute, isAuthError } from "@/lib/authorization/require-role";
import { invokeEdgeFunctionAsUser, isErrorResponse } from "@/lib/authorization/edge-function-proxy";

/**
 * GET/POST /api/admin/users -- explicit proxy to the existing admin-users
 * Edge Function (ADMIN-001). Search/summary reads, suspend/reinstate
 * writes. Never a generic passthrough: every field this route accepts is
 * named and validated below, and only forwarded in the exact shape
 * admin-users/index.ts's own schemas expect. Audit logging happens once,
 * inside _admin/users.ts's suspendUser/reinstateUser (already call
 * recordAudit, per ADMIN-001) -- not duplicated here.
 */

const getQuerySchema = z.object({
  view: z.enum(["search", "summary"]).default("search"),
  userId: z.string().uuid().optional(),
  search: z.string().max(200).optional(),
  status: z.string().max(50).optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
  cursor: z.string().optional(),
});

const postBodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("suspend"),
    userId: z.string().uuid(),
    reasonCode: z.string().min(1).max(100),
    notes: z.string().max(2000).default(""),
  }),
  z.object({ action: z.literal("reinstate"), userId: z.string().uuid() }),
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

  if (parsed.data.view === "summary" && !parsed.data.userId) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "userId is required for the summary view." } },
      { status: 400 },
    );
  }

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(parsed.data)) {
    if (value !== undefined) query.set(key, String(value));
  }

  const result = await invokeEdgeFunctionAsUser(supabase, accessToken, `admin-users?${query}`, {
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

  const result = await invokeEdgeFunctionAsUser(supabase, accessToken, "admin-users", {
    method: "POST",
    body: parsed.data,
  });
  if (isErrorResponse(result)) return result.errorResponse;

  return NextResponse.json({ data: result.data });
}
