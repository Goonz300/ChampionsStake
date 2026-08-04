// supabase/functions/challenge-complete/index.ts
// Normally invoked internally by releaseFunds (see escrow-transition.ts),
// but exposed as its own endpoint too so a future Dispute Engine can call
// it after a moderator_review decision without going through releaseFunds
// (which assumes a mutual-release path).

import { z } from "npm:zod@3.24.1";
import { withEdgeFunction, type EdgeContext } from "../_shared/middleware/index.ts";
import { requireModerator } from "../_shared/permissions/index.ts";
import { validateBody, parseJsonBody } from "../_shared/validation/validate.ts";
import { successResponse } from "../_shared/response/index.ts";
import { completeChallenge } from "../_challenge/escrow-transition.ts";

const bodySchema = z.object({ challengeId: z.string().uuid() });

async function handler(ctx: EdgeContext): Promise<Response> {
  // Gated to moderator+ since the only caller of this endpoint directly
  // (rather than via releaseFunds) is the future dispute-resolution path.
  requireModerator(ctx.profile!);

  const body = validateBody(bodySchema, await parseJsonBody(ctx.request));
  await completeChallenge(body.challengeId);

  return successResponse({ completed: true });
}

Deno.serve(
  withEdgeFunction({ functionName: "challenge-complete", auth: "required" }, handler),
);
