// supabase/functions/challenge-declare-winner/index.ts
// No Idempotency-Key header needed here — the concurrency protection is the
// conditional `result_locked` UPDATE inside declareWinner() itself, which is
// a stronger guarantee than a client-supplied key (it protects against two
// DIFFERENT idempotency keys from the two different participants racing
// each other, which an Idempotency-Key header alone cannot do).

import { z } from "npm:zod@3.24.1";
import {
  type EdgeContext,
  withEdgeFunction,
} from "../_shared/middleware/index.ts";
import { requirePlayer } from "../_shared/permissions/index.ts";
import { parseJsonBody, validateBody } from "../_shared/validation/validate.ts";
import { successResponse } from "../_shared/response/index.ts";
import { declareWinner } from "../_challenge/escrow-transition.ts";

const bodySchema = z.object({ challengeId: z.string().uuid() });

async function handler(ctx: EdgeContext): Promise<Response> {
  requirePlayer(ctx.profile!);

  const body = validateBody(bodySchema, await parseJsonBody(ctx.request));
  await declareWinner(body.challengeId, ctx.user!.id);

  return successResponse({ winner_submitted: true });
}

Deno.serve(
  withEdgeFunction(
    {
      functionName: "challenge-declare-winner",
      auth: "required",
      rateLimit: (ctx) => ({
        key: `challenge-declare-winner:${ctx.user?.id}`,
        windowSeconds: 60,
        maxRequests: 10,
      }),
    },
    handler,
  ),
);
