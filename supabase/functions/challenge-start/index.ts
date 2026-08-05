// supabase/functions/challenge-start/index.ts
// Callable by a scheduler (shared secret) or by a participant's client
// polling — but startMatch() itself only succeeds once the countdown has
// actually elapsed server-side, so this never trusts a client's timer.

import { z } from "zod";
import {
  type EdgeContext,
  withEdgeFunction,
} from "../_shared/middleware/index.ts";
import { requirePlayer } from "../_shared/permissions/index.ts";
import { parseJsonBody, validateBody } from "../_shared/validation/validate.ts";
import { successResponse } from "../_shared/response/index.ts";
import { config } from "../_shared/config/index.ts";
import { startMatch } from "../_challenge/escrow-transition.ts";
import { isParticipant } from "../_challenge/repository.ts";
import { AuthorizationError } from "../_shared/errors/index.ts";

const bodySchema = z.object({ challengeId: z.string().uuid() });

function isScheduledCall(request: Request): boolean {
  const authHeader = request.headers.get("Authorization");
  const secret = config.security.scheduledJobSharedSecret;
  return Boolean(secret) && authHeader === `Bearer ${secret}`;
}

async function handler(ctx: EdgeContext): Promise<Response> {
  const body = validateBody(bodySchema, await parseJsonBody(ctx.request));

  if (!isScheduledCall(ctx.request)) {
    requirePlayer(ctx.profile!);
    if (!(await isParticipant(body.challengeId, ctx.user!.id))) {
      throw new AuthorizationError(
        "Only challenge participants may trigger match start.",
      );
    }
  }

  await startMatch(body.challengeId);
  return successResponse({ started: true });
}

Deno.serve(
  withEdgeFunction(
    { functionName: "challenge-start", auth: "optional" },
    handler,
  ),
);
