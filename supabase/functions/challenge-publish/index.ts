// supabase/functions/challenge-publish/index.ts

import { z } from "npm:zod@3.24.1";
import {
  type EdgeContext,
  withEdgeFunction,
} from "../_shared/middleware/index.ts";
import { requireVerifiedPlayer } from "../_shared/permissions/index.ts";
import { parseJsonBody, validateBody } from "../_shared/validation/validate.ts";
import { idempotencyKeyHeaderSchema } from "../_shared/validation/schemas.ts";
import { successResponse } from "../_shared/response/index.ts";
import {
  beginIdempotentRequest,
  completeIdempotentRequest,
  failIdempotentRequest,
} from "../_shared/idempotency/index.ts";
import { publishChallenge } from "../_challenge/escrow-transition.ts";

const bodySchema = z.object({ challengeId: z.string().uuid() });

async function handler(ctx: EdgeContext): Promise<Response> {
  requireVerifiedPlayer(ctx.profile!);

  const idempotencyKey = idempotencyKeyHeaderSchema.parse(
    ctx.request.headers.get("Idempotency-Key"),
  );
  const body = validateBody(bodySchema, await parseJsonBody(ctx.request));

  const idempotency = await beginIdempotentRequest<{ published: boolean }>(
    idempotencyKey,
    "challenge-publish",
    body,
  );
  if (idempotency.kind === "replayed") {
    return successResponse(idempotency.response.body, {
      status: idempotency.response.statusCode,
    });
  }

  try {
    await publishChallenge(body.challengeId, ctx.user!.id);
    const responseBody = { published: true };
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
      functionName: "challenge-publish",
      auth: "required",
      rateLimit: (ctx) => ({
        key: `challenge-publish:${ctx.user?.id}`,
        windowSeconds: 60,
        maxRequests: 10,
      }),
    },
    handler,
  ),
);
