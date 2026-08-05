// supabase/functions/challenge-cancel/index.ts

import { z } from "zod";
import {
  type EdgeContext,
  withEdgeFunction,
} from "../_shared/middleware/index.ts";
import { requirePlayer } from "../_shared/permissions/index.ts";
import { parseJsonBody, validateBody } from "../_shared/validation/validate.ts";
import { idempotencyKeyHeaderSchema } from "../_shared/validation/schemas.ts";
import { successResponse } from "../_shared/response/index.ts";
import {
  beginIdempotentRequest,
  completeIdempotentRequest,
  failIdempotentRequest,
} from "../_shared/idempotency/index.ts";
import { cancelChallenge } from "../_challenge/escrow-transition.ts";

const bodySchema = z.object({
  challengeId: z.string().uuid(),
  reason: z.string().min(1).max(500).default("No reason provided."),
});

async function handler(ctx: EdgeContext): Promise<Response> {
  requirePlayer(ctx.profile!);

  const idempotencyKey = idempotencyKeyHeaderSchema.parse(
    ctx.request.headers.get("Idempotency-Key"),
  );
  const body = validateBody(bodySchema, await parseJsonBody(ctx.request));

  const idempotency = await beginIdempotentRequest<{ cancelled: boolean }>(
    idempotencyKey,
    "challenge-cancel",
    body,
  );
  if (idempotency.kind === "replayed") {
    return successResponse(idempotency.response.body, {
      status: idempotency.response.statusCode,
    });
  }

  try {
    await cancelChallenge(body.challengeId, ctx.user!.id, body.reason);
    const responseBody = { cancelled: true };
    await completeIdempotentRequest(idempotencyKey, 200, responseBody);
    return successResponse(responseBody);
  } catch (err) {
    await failIdempotentRequest(idempotencyKey);
    throw err;
  }
}

Deno.serve(
  withEdgeFunction(
    {
      functionName: "challenge-cancel",
      auth: "required",
      rateLimit: (ctx) => ({
        key: `challenge-cancel:${ctx.user?.id}`,
        windowSeconds: 60,
        maxRequests: 10,
      }),
    },
    handler,
  ),
);
