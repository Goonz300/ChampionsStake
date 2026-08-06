import { NextResponse, type NextRequest } from "next/server";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { z } from "zod";
import { requireRoleForRoute, isAuthError } from "@/lib/authorization/require-role";
import { invokeEdgeFunctionAsUser, isErrorResponse } from "@/lib/authorization/edge-function-proxy";

/**
 * GET/POST /api/admin/wallets -- explicit proxy to the existing
 * admin-wallets Edge Function (ADMIN-001). Balance/transactions/ledger/
 * statement reads, freeze/unfreeze writes. freeze/unfreeze are already
 * audited (via _wallet/service.ts's freezeWallet/unfreezeWallet, reused
 * from WALLET-001) -- not duplicated here.
 *
 * The statement view's csv format returns a raw CSV body, not the usual
 * {data:...} JSON envelope -- handled as a one-off special case below
 * rather than complicating the shared invokeEdgeFunctionAsUser helper for
 * every other route's sake.
 */

const getQuerySchema = z.object({
  view: z.enum(["balance", "transactions", "ledger", "statement"]).default("balance"),
  userId: z.string().uuid(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  format: z.enum(["json", "csv"]).default("json"),
  limit: z.coerce.number().int().positive().max(100).default(20),
  cursor: z.string().optional(),
});

const postBodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("freeze"),
    walletId: z.string().uuid(),
    reason: z.string().min(1).max(500),
  }),
  z.object({ action: z.literal("unfreeze"), walletId: z.string().uuid() }),
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

  if (parsed.data.view === "statement" && (!parsed.data.from || !parsed.data.to)) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "from and to are required for the statement view.",
        },
      },
      { status: 400 },
    );
  }

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(parsed.data)) {
    if (value !== undefined) query.set(key, String(value));
  }

  if (parsed.data.view === "statement" && parsed.data.format === "csv") {
    const { data, error } = await supabase.functions.invoke(`admin-wallets?${query}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (error) {
      // Forward the Edge Function's real status/body (e.g. a 404 for an
      // unknown wallet), same as invokeEdgeFunctionAsUser does for every
      // other route -- this branch bypasses that helper only because a
      // csv response isn't the standard {data:...} JSON envelope, not
      // because its errors deserve different treatment.
      if (error instanceof FunctionsHttpError) {
        const body = await error.context.json().catch(() => null);
        return NextResponse.json(
          body ?? { error: { code: "INTERNAL_ERROR", message: "Failed to generate statement." } },
          { status: error.context.status },
        );
      }
      return NextResponse.json(
        { error: { code: "INTERNAL_ERROR", message: "Failed to generate statement." } },
        { status: 502 },
      );
    }
    return new Response(data as string, {
      status: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": "attachment; filename=statement.csv",
      },
    });
  }

  const result = await invokeEdgeFunctionAsUser(supabase, accessToken, `admin-wallets?${query}`, {
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

  const result = await invokeEdgeFunctionAsUser(supabase, accessToken, "admin-wallets", {
    method: "POST",
    body: parsed.data,
  });
  if (isErrorResponse(result)) return result.errorResponse;

  return NextResponse.json({ data: result.data });
}
