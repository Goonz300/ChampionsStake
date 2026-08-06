// supabase/functions/chat-send/index.ts

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
import { sendMessage } from "../_realtime/chat.ts";

const bodySchema = z.object({
  challengeId: z.string().uuid(),
  type: z.enum(["text", "image", "video", "voice"]),
  content: z.string().max(2000).optional(),
  fileUploadId: z.string().uuid().optional(),
});

/**
 * Phase 4 fix: a client retrying a send after a network hiccup (the
 * classic case "optimistic update" support needs to guard against) had no
 * way to avoid creating a duplicate message. Reuses the SAME
 * beginIdempotentRequest/completeIdempotentRequest/failIdempotentRequest
 * helper challenge-publish/wallet-transfer/tournament-register already
 * use -- not a second idempotency mechanism. The Idempotency-Key header is
 * REQUIRED (idempotencyKeyHeaderSchema.parse throws on a missing/invalid
 * key, matching those same call sites), so every client must generate one
 * per logical send attempt.
 */
async function handler(ctx: EdgeContext): Promise<Response> {
  requirePlayer(ctx.profile!);

  const idempotencyKey = idempotencyKeyHeaderSchema.parse(
    ctx.request.headers.get("Idempotency-Key"),
  );
  const body = validateBody(bodySchema, await parseJsonBody(ctx.request));

  const idempotency = await beginIdempotentRequest<{ id: string }>(
    idempotencyKey,
    "chat-send",
    body,
  );
  if (idempotency.kind === "replayed") {
    return successResponse(idempotency.response.body, {
      status: idempotency.response.statusCode,
    });
  }

  try {
    const result = await sendMessage({ ...body, senderId: ctx.user!.id });
    await completeIdempotentRequest(idempotencyKey, 201, result);
    return successResponse(result, { status: 201 });
  } catch (err) {
    await failIdempotentRequest(idempotencyKey);
    throw err;
  }
}

Deno.serve(
  withEdgeFunction(
    {
      functionName: "chat-send",
      auth: "required",
      rateLimit: (ctx) => ({
        key: `chat-send:${ctx.user?.id}`,
        windowSeconds: 60,
        maxRequests: 60,
      }),
    },
    handler,
  ),
);
