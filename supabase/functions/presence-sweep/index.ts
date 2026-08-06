// supabase/functions/presence-sweep/index.ts
//
// Phase 4 fix: _realtime/presence.ts's sweepStalePresence() has existed
// since REALTIME-001 but was never scheduled or called from anywhere --
// migration 0054's own comment claimed it was scheduled; it wasn't (see
// migration 0075). This is that missing scheduled entry point, mirroring
// notification-send/index.ts's identical dual admin-or-scheduled-secret
// pattern exactly.

import {
  type EdgeContext,
  withEdgeFunction,
} from "../_shared/middleware/index.ts";
import { requireAdministrator } from "../_shared/permissions/index.ts";
import { successResponse } from "../_shared/response/index.ts";
import { AuthenticationError } from "../_shared/errors/index.ts";
import { config } from "../_shared/config/index.ts";
import { timingSafeEqual } from "../_shared/security/signed-requests.ts";
import { sweepStalePresence } from "../_realtime/presence.ts";

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

  const result = await sweepStalePresence();
  return successResponse(result);
}

Deno.serve(
  withEdgeFunction(
    { functionName: "presence-sweep", auth: "optional" },
    handler,
  ),
);
