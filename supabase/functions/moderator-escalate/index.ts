// supabase/functions/moderator-escalate/index.ts
// Thin wrapper -- escalation is also reachable via moderator-assign's
// "escalate" action; this dedicated endpoint exists because the brief
// names it as its own Edge Function.

import { z } from "zod";
import {
  type EdgeContext,
  withEdgeFunction,
} from "../_shared/middleware/index.ts";
import { requireModerator } from "../_shared/permissions/index.ts";
import { parseJsonBody, validateBody } from "../_shared/validation/validate.ts";
import { successResponse } from "../_shared/response/index.ts";
import { escalateDispute } from "../_moderator/queue.ts";

const bodySchema = z.object({
  disputeId: z.string().uuid(),
  adminId: z.string().uuid(),
  reason: z.string().min(1),
});

async function handler(ctx: EdgeContext): Promise<Response> {
  requireModerator(ctx.profile!);
  const body = validateBody(bodySchema, await parseJsonBody(ctx.request));
  await escalateDispute(
    body.disputeId,
    body.adminId,
    ctx.user!.id,
    body.reason,
  );
  return successResponse({ escalated: true });
}

Deno.serve(
  withEdgeFunction(
    {
      functionName: "moderator-escalate",
      auth: "required",
      rateLimit: (ctx) => ({
        key: `moderator-escalate:${ctx.user!.id}`,
        windowSeconds: 60,
        maxRequests: 20,
      }),
    },
    handler,
  ),
);
