// supabase/functions/chat-edit/index.ts

import { z } from "npm:zod@3.24.1";
import { withEdgeFunction, type EdgeContext } from "../_shared/middleware/index.ts";
import { requirePlayer } from "../_shared/permissions/index.ts";
import { validateBody, parseJsonBody } from "../_shared/validation/validate.ts";
import { successResponse } from "../_shared/response/index.ts";
import { editMessage } from "../_realtime/chat.ts";

const bodySchema = z.object({ messageId: z.string().uuid(), content: z.string().min(1).max(2000) });

async function handler(ctx: EdgeContext): Promise<Response> {
  requirePlayer(ctx.profile!);
  const body = validateBody(bodySchema, await parseJsonBody(ctx.request));
  await editMessage(body.messageId, ctx.user!.id, body.content);
  return successResponse({ edited: true });
}

Deno.serve(withEdgeFunction({ functionName: "chat-edit", auth: "required" }, handler));
