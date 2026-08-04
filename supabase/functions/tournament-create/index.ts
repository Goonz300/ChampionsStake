// supabase/functions/tournament-create/index.ts

import { withEdgeFunction, type EdgeContext } from "../_shared/middleware/index.ts";
import { requireAdministrator } from "../_shared/permissions/index.ts";
import { validateBody, parseJsonBody } from "../_shared/validation/validate.ts";
import { successResponse } from "../_shared/response/index.ts";
import { createTournamentSchema, createTournament } from "../_tournament/workflow.ts";

async function handler(ctx: EdgeContext): Promise<Response> {
  requireAdministrator(ctx.profile!);
  const body = validateBody(createTournamentSchema, await parseJsonBody(ctx.request));
  const result = await createTournament(ctx.user!.id, body);
  return successResponse(result, { status: 201 });
}

Deno.serve(withEdgeFunction({ functionName: "tournament-create", auth: "required" }, handler));
