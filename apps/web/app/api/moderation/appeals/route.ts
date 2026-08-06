import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuthenticatedCaller, isAuthError } from "@/lib/authorization/require-role";
import { invokeEdgeFunctionAsUser, isErrorResponse } from "@/lib/authorization/edge-function-proxy";

/**
 * POST /api/moderation/appeals -- explicit proxy to the existing
 * moderator-appeal Edge Function (MODERATOR-001), which is POST-only (no
 * GET surface exists to proxy). Deliberately does NOT gate this whole
 * route behind requireRoleForRoute("is_moderator"): authorization here is
 * genuinely per-action -- "file" requires only that the caller is a
 * participant in the underlying dispute (any player), while
 * "assign_reviewer"/"decide" require a real administrator. moderator-appeal
 * itself already implements this exact distinction correctly
 * (requirePlayer + isDisputeParticipant for file; requireAdministrator for
 * the other two) -- re-deriving a single blanket role check here would
 * either wrongly block ordinary players from filing an appeal, or wrongly
 * let a non-admin moderator reach assign_reviewer/decide. This route only
 * authenticates the caller and forwards; the Edge Function's own check
 * remains the sole authorization boundary for this one.
 */

const postBodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("file"), disputeId: z.string().uuid() }),
  z.object({
    action: z.literal("assign_reviewer"),
    disputeId: z.string().uuid(),
    reviewerId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("decide"),
    disputeId: z.string().uuid(),
    resolution: z.enum(["winner_confirmed", "opponent_confirmed", "voided"]),
    rationale: z.string().min(10).max(2000),
  }),
]);

export async function POST(request: NextRequest) {
  const authResult = await requireAuthenticatedCaller();
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

  const result = await invokeEdgeFunctionAsUser(supabase, accessToken, "moderator-appeal", {
    method: "POST",
    body: parsed.data,
  });
  if (isErrorResponse(result)) return result.errorResponse;

  return NextResponse.json({ data: result.data });
}
