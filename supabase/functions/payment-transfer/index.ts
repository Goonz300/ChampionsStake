// supabase/functions/payment-transfer/index.ts
// POST with action='create_payout_method' or 'withdraw'.

import { z } from "npm:zod@3.24.1";
import { withEdgeFunction, type EdgeContext } from "../_shared/middleware/index.ts";
import { requireVerifiedPlayer } from "../_shared/permissions/index.ts";
import { validateBody, parseJsonBody } from "../_shared/validation/validate.ts";
import { idempotencyKeyHeaderSchema } from "../_shared/validation/schemas.ts";
import { successResponse } from "../_shared/response/index.ts";
import { ValidationError } from "../_shared/errors/index.ts";
import { createPayoutMethod, requestWithdrawal } from "../_payment/withdrawal-service.ts";

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create_payout_method"),
    bankCode: z.string().min(1),
    accountNumber: z.string().min(1),
    accountName: z.string().min(1),
  }),
  z.object({ action: z.literal("withdraw"), payoutMethodId: z.string().uuid(), amountCents: z.number().int().positive() }),
]);

async function handler(ctx: EdgeContext): Promise<Response> {
  requireVerifiedPlayer(ctx.profile!);
  const body = validateBody(bodySchema, await parseJsonBody(ctx.request));

  if (body.action === "create_payout_method") {
    const result = await createPayoutMethod(ctx.user!.id, body.bankCode, body.accountNumber, body.accountName);
    return successResponse(result, { status: 201 });
  }

  if (body.action === "withdraw") {
    const idempotencyKey = idempotencyKeyHeaderSchema.parse(ctx.request.headers.get("Idempotency-Key"));
    const result = await requestWithdrawal(ctx.user!.id, body.payoutMethodId, body.amountCents, idempotencyKey);
    return successResponse(result, { status: 201 });
  }

  throw new ValidationError("Unsupported action.");
}

Deno.serve(
  withEdgeFunction(
    {
      functionName: "payment-transfer",
      auth: "required",
      rateLimit: (ctx) => ({ key: `payment-transfer:${ctx.user?.id}`, windowSeconds: 60, maxRequests: 10 }),
    },
    handler,
  ),
);
