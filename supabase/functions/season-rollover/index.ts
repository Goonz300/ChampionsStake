// supabase/functions/season-rollover/index.ts
// Scheduled sweep (or admin-triggered), same dual admin-or-scheduled-secret
// pattern as the ai-* Edge Functions.

import {
  type EdgeContext,
  withEdgeFunction,
} from "../_shared/middleware/index.ts";
import { requireAdministrator } from "../_shared/permissions/index.ts";
import { successResponse } from "../_shared/response/index.ts";
import { AuthenticationError } from "../_shared/errors/index.ts";
import { config } from "../_shared/config/index.ts";
import { timingSafeEqual } from "../_shared/security/signed-requests.ts";
import { rolloverDueSeasons } from "../_league/season-service.ts";

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

  const result = await rolloverDueSeasons();
  return successResponse(result);
}

Deno.serve(
  withEdgeFunction(
    {
      functionName: "season-rollover",
      auth: "optional",
      rateLimit: (ctx) => ({
        key: `season-rollover:${ctx.user?.id ?? "scheduled"}`,
        windowSeconds: 60,
        maxRequests: 5,
      }),
    },
    handler,
  ),
);
