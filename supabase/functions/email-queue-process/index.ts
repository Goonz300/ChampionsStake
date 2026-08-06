// supabase/functions/email-queue-process/index.ts
//
// Phase 4: the missing consumer for email_queue (migration 0065), which
// was durable schema with zero readers before this file existed. Mirrors
// notification-send/index.ts's and presence-sweep/index.ts's identical
// dual admin-or-scheduled-secret pattern exactly.

import {
  type EdgeContext,
  withEdgeFunction,
} from "../_shared/middleware/index.ts";
import { requireAdministrator } from "../_shared/permissions/index.ts";
import { successResponse } from "../_shared/response/index.ts";
import { AuthenticationError } from "../_shared/errors/index.ts";
import { config } from "../_shared/config/index.ts";
import { timingSafeEqual } from "../_shared/security/signed-requests.ts";
import { processEmailQueue } from "../_realtime/email-worker.ts";

function isScheduledCall(request: Request): boolean {
  const authHeader = request.headers.get("Authorization");
  const secret = config.security.scheduledJobSharedSecret;
  if (!secret || !authHeader) return false;
  return timingSafeEqual(authHeader, `Bearer ${secret}`);
}

async function handler(ctx: EdgeContext): Promise<Response> {
  if (!isScheduledCall(ctx.request)) {
    if (!ctx.profile) throw new AuthenticationError("Not authenticated.");
    requireAdministrator(ctx.profile);
  }

  const result = await processEmailQueue();
  return successResponse(result);
}

Deno.serve(
  withEdgeFunction(
    { functionName: "email-queue-process", auth: "optional" },
    handler,
  ),
);
