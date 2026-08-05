// supabase/functions/tournament-complete/index.ts
// Triggers prize distribution (event only — never moves money directly,
// per this phase's explicit instruction) and marks the tournament completed.

import { z } from "npm:zod@3.24.1";
import {
  type EdgeContext,
  withEdgeFunction,
} from "../_shared/middleware/index.ts";
import { requireAdministrator } from "../_shared/permissions/index.ts";
import { parseJsonBody, validateBody } from "../_shared/validation/validate.ts";
import { successResponse } from "../_shared/response/index.ts";
import { triggerPrizeDistribution } from "../_tournament/workflow.ts";

const bodySchema = z.object({ tournamentId: z.string().uuid() });

async function handler(ctx: EdgeContext): Promise<Response> {
  requireAdministrator(ctx.profile!);
  const body = validateBody(bodySchema, await parseJsonBody(ctx.request));
  await triggerPrizeDistribution(body.tournamentId);
  return successResponse({ completed: true });
}

Deno.serve(
  withEdgeFunction(
    { functionName: "tournament-complete", auth: "required" },
    handler,
  ),
);
