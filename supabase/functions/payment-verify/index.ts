// supabase/functions/payment-verify/index.ts

import { z } from "npm:zod@3.24.1";
import {
  type EdgeContext,
  withEdgeFunction,
} from "../_shared/middleware/index.ts";
import { requirePlayer } from "../_shared/permissions/index.ts";
import { validateQuery } from "../_shared/validation/validate.ts";
import { successResponse } from "../_shared/response/index.ts";
import { verifyAndCompleteDeposit } from "../_payment/deposit-service.ts";

const querySchema = z.object({ providerRef: z.string().min(1) });

async function handler(ctx: EdgeContext): Promise<Response> {
  requirePlayer(ctx.profile!);
  const url = new URL(ctx.request.url);
  const query = validateQuery(querySchema, url);
  const result = await verifyAndCompleteDeposit(query.providerRef);
  return successResponse(result);
}

Deno.serve(
  withEdgeFunction(
    { functionName: "payment-verify", auth: "required" },
    handler,
  ),
);
