// supabase/functions/chat-messages/index.ts
//
// Phase 4 fix: REALTIME-001 fully implemented cursor-paginated message
// history with signed-URL resolution (_realtime/chat.ts's getMessages),
// but no Edge Function ever called it -- the only participant-facing read
// path was sync-events' timestamp-based resync, which has no "load older
// history" capability. This is that missing entry point; it does not
// reimplement pagination, it just exposes what already existed.

import { z } from "zod";
import {
  type EdgeContext,
  withEdgeFunction,
} from "../_shared/middleware/index.ts";
import { requirePlayer } from "../_shared/permissions/index.ts";
import { validateQuery } from "../_shared/validation/validate.ts";
import { paginationQuerySchema } from "../_shared/validation/schemas.ts";
import { successResponse } from "../_shared/response/index.ts";
import { getMessages, markDelivered } from "../_realtime/chat.ts";

const querySchema = paginationQuerySchema.extend({
  challengeId: z.string().uuid(),
});

async function handler(ctx: EdgeContext): Promise<Response> {
  requirePlayer(ctx.profile!);
  const url = new URL(ctx.request.url);
  const query = validateQuery(querySchema, url);

  const messages = await getMessages(
    query.challengeId,
    ctx.user!.id,
    query.cursor,
    query.limit,
  );

  // Fetching a message is a reasonable, honest definition of "delivered"
  // for a pull-based read path -- wires up markDelivered (previously dead
  // code, Phase 4 fix) without inventing a separate manual acknowledgment
  // endpoint. Best-effort: a receipt-write failure must never fail the
  // actual read the client is waiting on.
  await Promise.all(
    messages.map((m) =>
      markDelivered(m.id as string, ctx.user!.id).catch(() => {})
    ),
  );

  return successResponse(messages);
}

Deno.serve(
  withEdgeFunction(
    { functionName: "chat-messages", auth: "required" },
    handler,
  ),
);
