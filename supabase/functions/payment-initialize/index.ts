// supabase/functions/payment-initialize/index.ts

import { z } from "npm:zod@3.24.1";
import { withEdgeFunction, type EdgeContext } from "../_shared/middleware/index.ts";
import { requireVerifiedPlayer } from "../_shared/permissions/index.ts";
import { validateBody, parseJsonBody } from "../_shared/validation/validate.ts";
import { idempotencyKeyHeaderSchema } from "../_shared/validation/schemas.ts";
import { successResponse } from "../_shared/response/index.ts";
import { initializeDeposit } from "../_payment/deposit-service.ts";

const bodySchema = z.object({ amountCents: z.number().int().positive() });

async function handler(ctx: EdgeContext): Promise<Response> {
  requireVerifiedPlayer(ctx.profile!);
  const idempotencyKey = idempotencyKeyHeaderSchema.parse(ctx.request.headers.get("Idempotency-Key"));
  const body = validateBody(bodySchema, await parseJsonBody(ctx.request));

  const result = await initializeDeposit(ctx.user!.id, body.amountCents, idempotencyKey);
  return successResponse(result, { status: 201 });
}

Deno.serve(
  withEdgeFunction(
    {
      functionName: "payment-initialize",
      auth: "required",
      rateLimit: (ctx) => ({ key: `payment-initialize:${ctx.user?.id}`, windowSeconds: 60, maxRequests: 10 }),
    },
    handler,
  ),
);
