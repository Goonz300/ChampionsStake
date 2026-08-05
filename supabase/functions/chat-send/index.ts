// supabase/functions/chat-send/index.ts

import { z } from "zod";
import {
  type EdgeContext,
  withEdgeFunction,
} from "../_shared/middleware/index.ts";
import { requirePlayer } from "../_shared/permissions/index.ts";
import { parseJsonBody, validateBody } from "../_shared/validation/validate.ts";
import { successResponse } from "../_shared/response/index.ts";
import { sendMessage } from "../_realtime/chat.ts";

const bodySchema = z.object({
  challengeId: z.string().uuid(),
  type: z.enum(["text", "image", "video", "voice"]),
  content: z.string().max(2000).optional(),
  fileUploadId: z.string().uuid().optional(),
});

async function handler(ctx: EdgeContext): Promise<Response> {
  requirePlayer(ctx.profile!);
  const body = validateBody(bodySchema, await parseJsonBody(ctx.request));
  const result = await sendMessage({ ...body, senderId: ctx.user!.id });
  return successResponse(result, { status: 201 });
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
