import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireRoleForRoute, isAuthError } from "@/lib/authorization/require-role";
import { invokeEdgeFunctionAsUser, isErrorResponse } from "@/lib/authorization/edge-function-proxy";

/**
 * GET/POST/PATCH /api/admin/announcements -- explicit proxy to the
 * existing admin-announcements Edge Function (ADMIN-001). createAnnouncement/
 * publishAnnouncement/retractAnnouncement already call recordAudit (per
 * ADMIN-001's own verification checklist) -- not duplicated here.
 */

const getQuerySchema = z.object({ status: z.string().max(50).optional() });

const createSchema = z.object({
  category: z.enum(["platform_notice", "maintenance", "tournament", "emergency"]),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(5000),
  expiresAt: z.string().datetime({ offset: true }).optional(),
});

const patchBodySchema = z.object({
  action: z.enum(["publish", "retract"]),
  announcementId: z.string().uuid(),
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
  if (parsed.data.status) query.set("status", parsed.data.status);

  const result = await invokeEdgeFunctionAsUser(
    supabase,
    accessToken,
    `admin-announcements?${query}`,
    { method: "GET" },
  );
  if (isErrorResponse(result)) return result.errorResponse;

  return NextResponse.json({ data: result.data });
}

export async function POST(request: NextRequest) {
  const authResult = await requireRoleForRoute("is_admin");
  if (isAuthError(authResult)) return authResult.errorResponse;
  const { supabase, accessToken } = authResult;

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message } },
      { status: 400 },
    );
  }

  const result = await invokeEdgeFunctionAsUser(supabase, accessToken, "admin-announcements", {
    method: "POST",
    body: parsed.data,
  });
  if (isErrorResponse(result)) return result.errorResponse;

  return NextResponse.json({ data: result.data }, { status: 201 });
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

  const result = await invokeEdgeFunctionAsUser(supabase, accessToken, "admin-announcements", {
    method: "PATCH",
    body: parsed.data,
  });
  if (isErrorResponse(result)) return result.errorResponse;

  return NextResponse.json({ data: result.data });
}
