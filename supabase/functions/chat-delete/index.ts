// supabase/functions/chat-delete/index.ts

import { z } from "zod";
import {
  type EdgeContext,
  withEdgeFunction,
} from "../_shared/middleware/index.ts";
import { requirePlayer } from "../_shared/permissions/index.ts";
import { isModerator } from "../_shared/auth/roles.ts";
import { validateQuery } from "../_shared/validation/validate.ts";
import { successResponse } from "../_shared/response/index.ts";
import { deleteMessage } from "../_realtime/chat.ts";

const querySchema = z.object({ messageId: z.string().uuid() });

async function handler(ctx: EdgeContext): Promise<Response> {
  requirePlayer(ctx.profile!);
  const url = new URL(ctx.request.url);
  const query = validateQuery(querySchema, url);
  // Phase 4 fix: deleteMessage now also permits a moderator to remove a
  // message, scoped to challenges with an active dispute -- see its own
  // doc comment. isModerator(ctx.profile!) reuses the existing role
  // predicate rather than re-deriving it.
  await deleteMessage(query.messageId, ctx.user!.id, isModerator(ctx.profile!));
  return successResponse({ deleted: true });
}

Deno.serve(
  withEdgeFunction({ functionName: "chat-delete", auth: "required" }, handler),
);
