// supabase/functions/typing-update/index.ts

import { z } from "npm:zod@3.24.1";
import {
  type EdgeContext,
  withEdgeFunction,
} from "../_shared/middleware/index.ts";
import { requirePlayer } from "../_shared/permissions/index.ts";
import { parseJsonBody, validateBody } from "../_shared/validation/validate.ts";
import { successResponse } from "../_shared/response/index.ts";
import { broadcastTyping } from "../_realtime/typing.ts";

const bodySchema = z.object({
  challengeId: z.string().uuid(),
  isTyping: z.boolean(),
});

async function handler(ctx: EdgeContext): Promise<Response> {
  requirePlayer(ctx.profile!);
  const body = validateBody(bodySchema, await parseJsonBody(ctx.request));
  await broadcastTyping(body.challengeId, ctx.user!.id, body.isTyping);
  return successResponse({ broadcast: true });
}

Deno.serve(
  withEdgeFunction(
    {
      functionName: "typing-update",
      auth: "required",
      rateLimit: (ctx) => ({
        key: `typing-update:${ctx.user?.id}`,
        windowSeconds: 10,
        maxRequests: 20,
      }),
    },
    handler,
  ),
);
