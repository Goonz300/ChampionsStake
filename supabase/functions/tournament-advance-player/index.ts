// supabase/functions/tournament-advance-player/index.ts
// Admin-only: resolves a bye or overrides a match result (e.g. disqualification).

import { z } from "zod";
import {
  type EdgeContext,
  withEdgeFunction,
} from "../_shared/middleware/index.ts";
import { requireAdministrator } from "../_shared/permissions/index.ts";
import { parseJsonBody, validateBody } from "../_shared/validation/validate.ts";
import { successResponse } from "../_shared/response/index.ts";
import { advancePlayer } from "../_tournament/workflow.ts";

const bodySchema = z.object({
  matchId: z.string().uuid(),
  winnerId: z.string().uuid(),
});

async function handler(ctx: EdgeContext): Promise<Response> {
  requireAdministrator(ctx.profile!);
  const body = validateBody(bodySchema, await parseJsonBody(ctx.request));
  await advancePlayer(body.matchId, body.winnerId, ctx.user!.id);
  return successResponse({ advanced: true });
}

Deno.serve(
  withEdgeFunction({
    functionName: "tournament-advance-player",
    auth: "required",
  }, handler),
);
