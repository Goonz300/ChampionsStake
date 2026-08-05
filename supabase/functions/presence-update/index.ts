// supabase/functions/presence-update/index.ts

import { z } from "npm:zod@3.24.1";
import {
  type EdgeContext,
  withEdgeFunction,
} from "../_shared/middleware/index.ts";
import { requirePlayer } from "../_shared/permissions/index.ts";
import { parseJsonBody, validateBody } from "../_shared/validation/validate.ts";
import { successResponse } from "../_shared/response/index.ts";
import { updatePresence } from "../_realtime/presence.ts";

const bodySchema = z.object({
  status: z.enum(["online", "offline", "away", "in_match", "ready"]),
  currentChallengeId: z.string().uuid().nullable().optional(),
});

async function handler(ctx: EdgeContext): Promise<Response> {
  requirePlayer(ctx.profile!);
  const body = validateBody(bodySchema, await parseJsonBody(ctx.request));
  // Never trust a client-supplied user_id -- always the caller's own JWT identity.
  await updatePresence(
    ctx.user!.id,
    body.status,
    body.currentChallengeId ?? null,
  );
  return successResponse({ updated: true });
}

Deno.serve(
  withEdgeFunction(
    {
      functionName: "presence-update",
      auth: "required",
      rateLimit: (ctx) => ({
        key: `presence-update:${ctx.user?.id}`,
        windowSeconds: 30,
        maxRequests: 10,
      }),
    },
    handler,
  ),
);
