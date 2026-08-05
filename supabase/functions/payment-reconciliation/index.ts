// supabase/functions/payment-reconciliation/index.ts
// Scheduled sweep (or admin-triggered), mirroring the dual admin-or-
// scheduled-secret pattern established since STORE-001.

import {
  type EdgeContext,
  withEdgeFunction,
} from "../_shared/middleware/index.ts";
import { requireAdministrator } from "../_shared/permissions/index.ts";
import { successResponse } from "../_shared/response/index.ts";
import { AuthenticationError } from "../_shared/errors/index.ts";
import { config } from "../_shared/config/index.ts";
import { reconcilePendingIntents } from "../_payment/reconciliation-service.ts";

function isScheduledCall(request: Request): boolean {
  const authHeader = request.headers.get("Authorization");
  const secret = config.security.scheduledJobSharedSecret;
  return Boolean(secret) && authHeader === `Bearer ${secret}`;
}

async function handler(ctx: EdgeContext): Promise<Response> {
  if (!isScheduledCall(ctx.request)) {
    if (!ctx.profile) throw new AuthenticationError("Not authenticated.");
    requireAdministrator(ctx.profile);
  }

  const result = await reconcilePendingIntents();
  return successResponse(result);
}

Deno.serve(
  withEdgeFunction(
    { functionName: "payment-reconciliation", auth: "optional" },
    handler,
  ),
);
