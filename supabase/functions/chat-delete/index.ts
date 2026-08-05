// supabase/functions/chat-delete/index.ts

import { z } from "npm:zod@3.24.1";
import {
  type EdgeContext,
  withEdgeFunction,
} from "../_shared/middleware/index.ts";
import { requirePlayer } from "../_shared/permissions/index.ts";
import { validateQuery } from "../_shared/validation/validate.ts";
import { successResponse } from "../_shared/response/index.ts";
import { deleteMessage } from "../_realtime/chat.ts";

const querySchema = z.object({ messageId: z.string().uuid() });

async function handler(ctx: EdgeContext): Promise<Response> {
  requirePlayer(ctx.profile!);
  const url = new URL(ctx.request.url);
  const query = validateQuery(querySchema, url);
  await deleteMessage(query.messageId, ctx.user!.id);
  return successResponse({ deleted: true });
}

Deno.serve(
  withEdgeFunction({ functionName: "chat-delete", auth: "required" }, handler),
);
