// supabase/functions/payment-refund/index.ts
// Admin-only — see refund-service.ts's header note on scope.

import { z } from "zod";
import {
  type EdgeContext,
  withEdgeFunction,
} from "../_shared/middleware/index.ts";
import { requireAdministrator } from "../_shared/permissions/index.ts";
import { parseJsonBody, validateBody } from "../_shared/validation/validate.ts";
import { successResponse } from "../_shared/response/index.ts";
import { initiateProviderRefund } from "../_payment/refund-service.ts";

const bodySchema = z.object({
  providerRef: z.string().min(1),
  amountCents: z.number().int().positive(),
  reason: z.string().min(1),
});

async function handler(ctx: EdgeContext): Promise<Response> {
  requireAdministrator(ctx.profile!);
  const body = validateBody(bodySchema, await parseJsonBody(ctx.request));
  const result = await initiateProviderRefund(
    body.providerRef,
    body.amountCents,
    body.reason,
    ctx.user!.id,
  );
  return successResponse(result);
}

Deno.serve(
  withEdgeFunction(
    {
      functionName: "payment-refund",
      auth: "required",
      rateLimit: (ctx) => ({
        key: `payment-refund:${ctx.user!.id}`,
        windowSeconds: 60,
        maxRequests: 5,
      }),
    },
    handler,
  ),
);
