// supabase/functions/tournament-create/index.ts

import {
  type EdgeContext,
  withEdgeFunction,
} from "../_shared/middleware/index.ts";
import { requireOrganizer } from "../_shared/permissions/index.ts";
import { parseJsonBody, validateBody } from "../_shared/validation/validate.ts";
import { successResponse } from "../_shared/response/index.ts";
import {
  createTournament,
  createTournamentSchema,
} from "../_tournament/workflow.ts";

async function handler(ctx: EdgeContext): Promise<Response> {
  // Phase 8 (TOURNAMENT-007): widened from requireAdministrator to
  // requireOrganizer (which still includes administrators) -- tournament
  // creation was admin-only before the Organizer Platform existed.
  requireOrganizer(ctx.profile!);
  const body = validateBody(
    createTournamentSchema,
    await parseJsonBody(ctx.request),
  );
  const result = await createTournament(ctx.user!.id, body);
  return successResponse(result, { status: 201 });
}

Deno.serve(
  withEdgeFunction(
    {
      functionName: "tournament-create",
      auth: "required",
      rateLimit: (ctx) => ({
        key: `tournament-create:${ctx.user!.id}`,
        windowSeconds: 60,
        maxRequests: 10,
      }),
    },
    handler,
  ),
);
