// supabase/functions/challenge-ready/index.ts
// No idempotency key required — readyCheck is naturally idempotent (a
// second call from the same user just re-confirms readiness, it doesn't
// move money or create a new resource).

import { z } from "npm:zod@3.24.1";
import {
  type EdgeContext,
  withEdgeFunction,
} from "../_shared/middleware/index.ts";
import { requirePlayer } from "../_shared/permissions/index.ts";
import { parseJsonBody, validateBody } from "../_shared/validation/validate.ts";
import { successResponse } from "../_shared/response/index.ts";
import { readyCheck } from "../_challenge/escrow-transition.ts";

const bodySchema = z.object({ challengeId: z.string().uuid() });

async function handler(ctx: EdgeContext): Promise<Response> {
  requirePlayer(ctx.profile!);

  const body = validateBody(bodySchema, await parseJsonBody(ctx.request));
  const result = await readyCheck(body.challengeId, ctx.user!.id);

  return successResponse({ ready: true, both_ready: result.bothReady });
}

Deno.serve(
  withEdgeFunction(
    {
      functionName: "challenge-ready",
      auth: "required",
      rateLimit: (ctx) => ({
        key: `challenge-ready:${ctx.user?.id}`,
        windowSeconds: 60,
        maxRequests: 20,
      }),
    },
    handler,
  ),
);
