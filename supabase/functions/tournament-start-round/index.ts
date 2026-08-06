// supabase/functions/tournament-start-round/index.ts

import { z } from "zod";
import {
  type EdgeContext,
  withEdgeFunction,
} from "../_shared/middleware/index.ts";
import { requireAdministrator } from "../_shared/permissions/index.ts";
import { parseJsonBody, validateBody } from "../_shared/validation/validate.ts";
import { successResponse } from "../_shared/response/index.ts";
import { startRound } from "../_tournament/workflow.ts";

const bodySchema = z.object({ tournamentId: z.string().uuid() });

async function handler(ctx: EdgeContext): Promise<Response> {
  requireAdministrator(ctx.profile!);
  const body = validateBody(bodySchema, await parseJsonBody(ctx.request));
  await startRound(body.tournamentId);
  return successResponse({ round_started: true });
}

Deno.serve(
  withEdgeFunction(
    {
      functionName: "tournament-start-round",
      auth: "required",
      rateLimit: (ctx) => ({
        key: `tournament-start-round:${ctx.user!.id}`,
        windowSeconds: 60,
        maxRequests: 10,
      }),
    },
    handler,
  ),
);
