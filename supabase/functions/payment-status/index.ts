// supabase/functions/payment-status/index.ts

import { z } from "npm:zod@3.24.1";
import { withEdgeFunction, type EdgeContext } from "../_shared/middleware/index.ts";
import { requirePlayer } from "../_shared/permissions/index.ts";
import { validateQuery } from "../_shared/validation/validate.ts";
import { successResponse } from "../_shared/response/index.ts";
import { AuthorizationError, NotFoundError } from "../_shared/errors/index.ts";
import { getServiceRoleClient } from "../_shared/database/client.ts";

const querySchema = z.object({ providerRef: z.string().min(1) });

async function handler(ctx: EdgeContext): Promise<Response> {
  requirePlayer(ctx.profile!);
  const url = new URL(ctx.request.url);
  const query = validateQuery(querySchema, url);

  const supabase = getServiceRoleClient();
  const { data: intent } = await supabase.from("payment_intents").select("*").eq("provider_ref", query.providerRef).maybeSingle();
  if (!intent) throw new NotFoundError(`No payment found for reference ${query.providerRef}.`);
  if (intent.user_id !== ctx.user!.id) throw new AuthorizationError("This payment does not belong to you.");

  return successResponse({ kind: intent.kind, status: intent.status, amountCents: intent.amount_cents, createdAt: intent.created_at });
}

Deno.serve(withEdgeFunction({ functionName: "payment-status", auth: "required" }, handler));
