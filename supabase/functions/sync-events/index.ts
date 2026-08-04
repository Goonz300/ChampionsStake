// supabase/functions/sync-events/index.ts

import { z } from "npm:zod@3.24.1";
import { withEdgeFunction, type EdgeContext } from "../_shared/middleware/index.ts";
import { requirePlayer } from "../_shared/permissions/index.ts";
import { validateQuery } from "../_shared/validation/validate.ts";
import { isoDateSchema } from "../_shared/validation/schemas.ts";
import { successResponse } from "../_shared/response/index.ts";
import { syncSince, syncChallengeSince } from "../_realtime/sync.ts";

const querySchema = z.object({
  since: isoDateSchema,
  challengeId: z.string().uuid().optional(),
});

async function handler(ctx: EdgeContext): Promise<Response> {
  requirePlayer(ctx.profile!);
  const url = new URL(ctx.request.url);
  const query = validateQuery(querySchema, url);

  if (query.challengeId) {
    const messages = await syncChallengeSince(query.challengeId, ctx.user!.id, query.since);
    return successResponse({ messages });
  }

  const result = await syncSince(ctx.user!.id, query.since);
  return successResponse(result);
}

Deno.serve(withEdgeFunction({ functionName: "sync-events", auth: "required" }, handler));
