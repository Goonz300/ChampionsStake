import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireRoleForRoute, isAuthError } from "@/lib/authorization/require-role";
import { invokeEdgeFunctionAsUser, isErrorResponse } from "@/lib/authorization/edge-function-proxy";

/**
 * GET/POST /api/moderation/cases -- explicit proxy to the existing case
 * detail/decision surface (MODERATOR-001): reads go through
 * moderator-dashboard's ?view=case/evidence, decisions go through
 * moderator-decision (all 7 decision types, each already recorded via
 * escrow-transition.ts's/decisions.ts's own recordAudit calls -- not
 * duplicated here). Every fund-moving decision (approve_winner,
 * approve_opponent, void_match) resolves through
 * _challenge/escrow-transition.ts inside moderator-decision -- this route
 * never touches a financial table, directly or indirectly.
 */

const getQuerySchema = z.object({
  view: z.enum(["case", "evidence"]).default("case"),
  disputeId: z.string().uuid(),
});

const postBodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("approve_winner"),
    disputeId: z.string().uuid(),
    rationale: z.string().min(10).max(2000),
  }),
  z.object({
    action: z.literal("approve_opponent"),
    disputeId: z.string().uuid(),
    rationale: z.string().min(10).max(2000),
  }),
  z.object({
    action: z.literal("dismiss_invalid"),
    disputeId: z.string().uuid(),
    rationale: z.string().min(10).max(2000),
  }),
  z.object({
    action: z.literal("void_match"),
    disputeId: z.string().uuid(),
    rationale: z.string().min(10).max(2000),
  }),
  z.object({
    action: z.literal("request_more_evidence"),
    disputeId: z.string().uuid(),
    extensionHours: z.number().int().positive().max(168).optional(),
  }),
  z.object({
    action: z.literal("return_to_players"),
    disputeId: z.string().uuid(),
    note: z.string().min(1).max(2000),
  }),
  z.object({ action: z.literal("reopen"), disputeId: z.string().uuid() }),
]);

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

  const query = new URLSearchParams({ view: parsed.data.view, disputeId: parsed.data.disputeId });

  const result = await invokeEdgeFunctionAsUser(
    supabase,
    accessToken,
    `moderator-dashboard?${query}`,
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

  const result = await invokeEdgeFunctionAsUser(supabase, accessToken, "moderator-decision", {
    method: "POST",
    body: parsed.data,
  });
  if (isErrorResponse(result)) return result.errorResponse;

  return NextResponse.json({ data: result.data });
}
