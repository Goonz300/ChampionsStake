// supabase/functions/tournament-publish/index.ts

import { z } from "npm:zod@3.24.1";
import { withEdgeFunction, type EdgeContext } from "../_shared/middleware/index.ts";
import { requireAdministrator } from "../_shared/permissions/index.ts";
import { validateBody, parseJsonBody } from "../_shared/validation/validate.ts";
import { successResponse } from "../_shared/response/index.ts";
import { publishTournament } from "../_tournament/workflow.ts";

const bodySchema = z.object({ tournamentId: z.string().uuid() });

async function handler(ctx: EdgeContext): Promise<Response> {
  requireAdministrator(ctx.profile!);
  const body = validateBody(bodySchema, await parseJsonBody(ctx.request));
  await publishTournament(body.tournamentId);
  return successResponse({ published: true });
}

Deno.serve(withEdgeFunction({ functionName: "tournament-publish", auth: "required" }, handler));
