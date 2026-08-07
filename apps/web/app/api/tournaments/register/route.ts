import { NextResponse, type NextRequest } from "next/server";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { isAuthError, requireAuthenticatedCaller } from "@/lib/authorization/require-role";

const bodySchema = z.object({ tournamentId: z.string().uuid() });

/** POST /api/tournaments/register -- proxy to tournament-register (an
 * existing, pre-Phase-8 Edge Function; not one of this phase's new
 * modules, but the frontend's first caller of it). Generates the
 * Idempotency-Key header server-side (randomUUID) rather than trusting the
 * client to supply one -- a client-supplied key would let a buggy or
 * malicious client reuse the same key across genuinely different
 * registration attempts. Hand-rolled invocation (not
 * invokeEdgeFunctionAsUser) because this call needs an extra header
 * (Idempotency-Key) that helper has no option for. */
export async function POST(request: NextRequest) {
  const authResult = await requireAuthenticatedCaller();
  if (isAuthError(authResult)) return authResult.errorResponse;
  const { supabase, accessToken } = authResult;

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message } },
      { status: 400 },
    );
  }

  const { data, error } = await supabase.functions.invoke("tournament-register", {
    method: "POST",
    body: parsed.data,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Idempotency-Key": randomUUID(),
    },
  });

  if (error) {
    if (error instanceof FunctionsHttpError) {
      const errorBody = await error.context.json().catch(() => null);
      return NextResponse.json(
        errorBody ?? {
          error: { code: "INTERNAL_ERROR", message: "Failed to register for tournament." },
        },
        { status: error.context.status },
      );
    }
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to reach the Edge Function." } },
      { status: 502 },
    );
  }

  return NextResponse.json({ data: (data as { data: unknown }).data }, { status: 201 });
}
