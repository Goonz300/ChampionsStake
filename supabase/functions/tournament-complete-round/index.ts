// supabase/functions/tournament-complete-round/index.ts
// Callable by an admin, or by a round-timeout scheduler (not scheduled by
// default in this phase — see TOURNAMENT-001-deliverable.md's note on
// sub-minute timer infrastructure, the same gap CHALLENGE-001 documented).

import { z } from "zod";
import {
  type EdgeContext,
  withEdgeFunction,
} from "../_shared/middleware/index.ts";
import { requireAdministrator } from "../_shared/permissions/index.ts";
import { parseJsonBody, validateBody } from "../_shared/validation/validate.ts";
import { successResponse } from "../_shared/response/index.ts";
import { config } from "../_shared/config/index.ts";
import { completeRound } from "../_tournament/workflow.ts";

const bodySchema = z.object({ tournamentId: z.string().uuid() });

function isScheduledCall(request: Request): boolean {
  const authHeader = request.headers.get("Authorization");
  const secret = config.security.scheduledJobSharedSecret;
  return Boolean(secret) && authHeader === `Bearer ${secret}`;
}

async function handler(ctx: EdgeContext): Promise<Response> {
  if (!isScheduledCall(ctx.request)) {
    requireAdministrator(ctx.profile!);
  }
  const body = validateBody(bodySchema, await parseJsonBody(ctx.request));
  const result = await completeRound(body.tournamentId);
  return successResponse(result);
}

Deno.serve(
  withEdgeFunction({
    functionName: "tournament-complete-round",
    auth: "optional",
  }, handler),
);
