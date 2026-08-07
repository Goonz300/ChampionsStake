// supabase/functions/tournament-complete/index.ts
// Triggers prize distribution -- releases every registrant's locked entry
// fee and credits the placement winners in one balanced ledger transaction
// (Phase 6 fix; see triggerPrizeDistribution's own doc comment) -- and
// marks the tournament completed.

import { z } from "zod";
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
  const { totalDistributedCents } = await triggerPrizeDistribution(
    body.tournamentId,
  );
  return successResponse({ completed: true, totalDistributedCents });
}

Deno.serve(
  withEdgeFunction(
    {
      functionName: "tournament-complete",
      auth: "required",
      rateLimit: (ctx) => ({
        key: `tournament-complete:${ctx.user!.id}`,
        windowSeconds: 60,
        maxRequests: 10,
      }),
    },
    handler,
  ),
);
