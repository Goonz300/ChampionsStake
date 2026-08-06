// supabase/functions/challenge-timeline/index.ts

import { z } from "zod";
import {
  type EdgeContext,
  withEdgeFunction,
} from "../_shared/middleware/index.ts";
import { requirePlayer } from "../_shared/permissions/index.ts";
import { validateQuery } from "../_shared/validation/validate.ts";
import { successResponse } from "../_shared/response/index.ts";
import { AuthorizationError } from "../_shared/errors/index.ts";
import { getChallengeTimeline } from "../_challenge/workflow.ts";
import { isParticipant } from "../_challenge/repository.ts";

const querySchema = z.object({ challengeId: z.string().uuid() });

async function handler(ctx: EdgeContext): Promise<Response> {
  requirePlayer(ctx.profile!);

  const url = new URL(ctx.request.url);
  const query = validateQuery(querySchema, url);

  const isStaff = ctx.profile!.role === "moderator" ||
    ctx.profile!.role === "administrator";
  if (!isStaff && !(await isParticipant(query.challengeId, ctx.user!.id))) {
    throw new AuthorizationError(
      "Only challenge participants (or staff) may view this timeline.",
    );
  }

  const timeline = await getChallengeTimeline(query.challengeId);
  return successResponse(timeline);
}

Deno.serve(
  withEdgeFunction(
    {
      functionName: "challenge-timeline",
      auth: "required",
      rateLimit: (ctx) => ({
        key: `challenge-timeline:${ctx.user!.id}`,
        windowSeconds: 60,
        maxRequests: 60,
      }),
    },
    handler,
  ),
);
