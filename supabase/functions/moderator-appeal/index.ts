// supabase/functions/moderator-appeal/index.ts

import { z } from "zod";
import {
  type EdgeContext,
  withEdgeFunction,
} from "../_shared/middleware/index.ts";
import {
  requireAdministrator,
  requirePlayer,
} from "../_shared/permissions/index.ts";
import { parseJsonBody, validateBody } from "../_shared/validation/validate.ts";
import { successResponse } from "../_shared/response/index.ts";
import {
  AuthorizationError,
  ValidationError,
} from "../_shared/errors/index.ts";
import {
  assignAppealReviewer,
  decideAppeal,
  fileAppeal,
} from "../_moderator/appeals.ts";
import { isDisputeParticipant } from "../_moderator/repository.ts";

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("file"), disputeId: z.string().uuid() }),
  z.object({
    action: z.literal("assign_reviewer"),
    disputeId: z.string().uuid(),
    reviewerId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("decide"),
    disputeId: z.string().uuid(),
    resolution: z.enum(["winner_confirmed", "opponent_confirmed", "voided"]),
    rationale: z.string().min(10),
  }),
]);

async function handler(ctx: EdgeContext): Promise<Response> {
  const body = validateBody(bodySchema, await parseJsonBody(ctx.request));

  if (body.action === "file") {
    requirePlayer(ctx.profile!);
    if (!(await isDisputeParticipant(body.disputeId, ctx.user!.id))) {
      throw new AuthorizationError(
        "Only dispute participants may file an appeal.",
      );
    }
    await fileAppeal(body.disputeId, ctx.user!.id);
    return successResponse({ filed: true });
  }

  requireAdministrator(ctx.profile!);

  if (body.action === "assign_reviewer") {
    await assignAppealReviewer(body.disputeId, body.reviewerId, ctx.user!.id);
    return successResponse({ assigned: true });
  }

  if (body.action === "decide") {
    await decideAppeal(
      body.disputeId,
      body.resolution,
      body.rationale,
      ctx.user!.id,
    );
    return successResponse({ decided: true });
  }

  throw new ValidationError("Unsupported action.");
}

Deno.serve(
  withEdgeFunction(
    {
      functionName: "moderator-appeal",
      auth: "required",
      rateLimit: (ctx) => ({
        key: `moderator-appeal:${ctx.user!.id}`,
        windowSeconds: 60,
        maxRequests: 20,
      }),
    },
    handler,
  ),
);
