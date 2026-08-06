import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireRoleForRoute, isAuthError } from "@/lib/authorization/require-role";
import { invokeEdgeFunctionAsUser, isErrorResponse } from "@/lib/authorization/edge-function-proxy";

/**
 * GET/POST /api/moderation/queue -- explicit proxy to the existing
 * dispute-queue surface (MODERATOR-001): reads go through
 * moderator-dashboard's ?view=queue, writes (assign/claim/escalate/set
 * priority) go through moderator-assign. Both already call requireModerator
 * and (for assign/claim/set_priority/escalate) recordAudit internally --
 * not duplicated here. The "assign" action additionally requires
 * administrator inside moderator-assign itself (one moderator assigning a
 * case to another) -- this route does not re-derive that finer rule, it
 * stays entirely inside the Edge Function it already lives in.
 */

const postBodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("auto_assign"), disputeId: z.string().uuid() }),
  z.object({
    action: z.literal("assign"),
    disputeId: z.string().uuid(),
    moderatorId: z.string().uuid(),
  }),
  z.object({ action: z.literal("claim"), disputeId: z.string().uuid() }),
  z.object({
    action: z.literal("set_priority"),
    disputeId: z.string().uuid(),
    priority: z.enum(["low", "normal", "high", "urgent"]),
  }),
  z.object({
    action: z.literal("escalate"),
    disputeId: z.string().uuid(),
    adminId: z.string().uuid(),
    reason: z.string().min(1).max(1000),
  }),
]);

export async function GET() {
  const authResult = await requireRoleForRoute("is_moderator");
  if (isAuthError(authResult)) return authResult.errorResponse;
  const { supabase, accessToken } = authResult;

  const result = await invokeEdgeFunctionAsUser(
    supabase,
    accessToken,
    "moderator-dashboard?view=queue",
    { method: "GET" },
  );
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

  const result = await invokeEdgeFunctionAsUser(supabase, accessToken, "moderator-assign", {
    method: "POST",
    body: parsed.data,
  });
  if (isErrorResponse(result)) return result.errorResponse;

  return NextResponse.json({ data: result.data });
}
