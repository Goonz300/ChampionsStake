// supabase/functions/notification-send/index.ts
// Scheduler-driven (or admin-triggered) sweep of unprocessed domain_events
// into notifications rows. Mirrors the dual admin-or-scheduled-secret
// pattern established since STORE-001.

import {
  type EdgeContext,
  withEdgeFunction,
} from "../_shared/middleware/index.ts";
import { requireAdministrator } from "../_shared/permissions/index.ts";
import { successResponse } from "../_shared/response/index.ts";
import { AuthenticationError } from "../_shared/errors/index.ts";
import { config } from "../_shared/config/index.ts";
import { timingSafeEqual } from "../_shared/security/signed-requests.ts";
import { processUnhandledEvents } from "../_realtime/notifications.ts";

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

  const result = await processUnhandledEvents();
  return successResponse(result);
}

Deno.serve(
  withEdgeFunction(
    { functionName: "notification-send", auth: "optional" },
    handler,
  ),
);
