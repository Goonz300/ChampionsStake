// supabase/functions/tournament-scheduling-sweep/index.ts
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
import {
  sweepAutomaticLifecycleTransitions,
  sweepTournamentReminders,
} from "../_tournament/scheduling.ts";

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

  const [lifecycle, reminders] = await Promise.all([
    sweepAutomaticLifecycleTransitions(),
    sweepTournamentReminders(),
  ]);

  return successResponse({ lifecycle, reminders });
}

Deno.serve(
  withEdgeFunction(
    {
      functionName: "tournament-scheduling-sweep",
      auth: "optional",
      rateLimit: (ctx) => ({
        key: `tournament-scheduling-sweep:${ctx.user?.id ?? "scheduled"}`,
        windowSeconds: 60,
        maxRequests: 5,
      }),
    },
    handler,
  ),
);
