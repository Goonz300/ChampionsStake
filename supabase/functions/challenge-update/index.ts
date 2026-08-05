// supabase/functions/challenge-update/index.ts
// PATCH: edit a draft. DELETE: delete a draft. Both share the resource, so
// one function dispatches on method, same pattern as wallet-adjustment.

import { z } from "zod";
import {
  type EdgeContext,
  withEdgeFunction,
} from "../_shared/middleware/index.ts";
import { requirePlayer } from "../_shared/permissions/index.ts";
import { parseJsonBody, validateBody } from "../_shared/validation/validate.ts";
import {
  noContentResponse,
  successResponse,
} from "../_shared/response/index.ts";
import { ValidationError } from "../_shared/errors/index.ts";
import {
  deleteChallenge,
  updateChallenge,
  updateChallengeSchema,
} from "../_challenge/workflow.ts";

const pathSchema = z.object({ challengeId: z.string().uuid() });

async function handlePatch(
  ctx: EdgeContext,
  challengeId: string,
): Promise<Response> {
  requirePlayer(ctx.profile!);
  const body = validateBody(
    updateChallengeSchema,
    await parseJsonBody(ctx.request),
  );
  await updateChallenge(challengeId, ctx.user!.id, body);
  return successResponse({ updated: true });
}

async function handleDelete(
  ctx: EdgeContext,
  challengeId: string,
): Promise<Response> {
  requirePlayer(ctx.profile!);
  await deleteChallenge(challengeId, ctx.user!.id);
  return noContentResponse();
}

function handler(ctx: EdgeContext): Promise<Response> {
  const url = new URL(ctx.request.url);
  const { challengeId } = pathSchema.parse({
    challengeId: url.searchParams.get("challengeId"),
  });

  if (ctx.request.method === "PATCH") return handlePatch(ctx, challengeId);
  if (ctx.request.method === "DELETE") return handleDelete(ctx, challengeId);

  throw new ValidationError(
    `Unsupported method ${ctx.request.method}. Use PATCH to edit or DELETE to remove a draft.`,
  );
}

Deno.serve(
  withEdgeFunction(
    { functionName: "challenge-update", auth: "required" },
    handler,
  ),
);
