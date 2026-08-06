import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireRoleForRoute, isAuthError } from "@/lib/authorization/require-role";
import { invokeEdgeFunctionAsUser, isErrorResponse } from "@/lib/authorization/edge-function-proxy";

/**
 * GET/POST /api/moderation/notes -- explicit proxy to the existing
 * moderator-note Edge Function (MODERATOR-001). Notes are moderator-only
 * (never visible to players, by design -- no participant RLS policy
 * exists on dispute_notes at all). Adding a note is now audited (Phase 3D
 * fix to _moderator/notes.ts's addNote) -- not duplicated here.
 */

const getQuerySchema = z.object({ disputeId: z.string().uuid() });
const postBodySchema = z.object({
  disputeId: z.string().uuid(),
  content: z.string().min(1).max(5000),
});

export async function GET(request: NextRequest) {
  const authResult = await requireRoleForRoute("is_moderator");
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

  const query = new URLSearchParams({ disputeId: parsed.data.disputeId });

  const result = await invokeEdgeFunctionAsUser(supabase, accessToken, `moderator-note?${query}`, {
    method: "GET",
  });
  if (isErrorResponse(result)) return result.errorResponse;

  return NextResponse.json({ data: result.data });
}

export async function POST(request: NextRequest) {
  const authResult = await requireRoleForRoute("is_moderator");
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

  const result = await invokeEdgeFunctionAsUser(supabase, accessToken, "moderator-note", {
    method: "POST",
    body: parsed.data,
  });
  if (isErrorResponse(result)) return result.errorResponse;

  return NextResponse.json({ data: result.data }, { status: 201 });
}
