// supabase/functions/tournament-checkin/index.ts
// POST with a caller: player checks themselves in.
// POST with the scheduled shared secret: sweep mode, forfeits no-shows.

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
import { ValidationError } from "../_shared/errors/index.ts";
import { config } from "../_shared/config/index.ts";
import { timingSafeEqual } from "../_shared/security/signed-requests.ts";
import {
  checkIn,
  forfeitNoShows,
  openCheckIn,
} from "../_tournament/workflow.ts";

const bodySchema = z.object({
  tournamentId: z.string().uuid(),
  action: z.enum(["checkin", "open", "sweep"]).default("checkin"),
});

function isScheduledCall(request: Request): boolean {
  const authHeader = request.headers.get("Authorization");
  const secret = config.security.scheduledJobSharedSecret;
  if (!secret || !authHeader) return false;
  return timingSafeEqual(authHeader, `Bearer ${secret}`);
}

async function handler(ctx: EdgeContext): Promise<Response> {
  const body = validateBody(bodySchema, await parseJsonBody(ctx.request));

  if (body.action === "sweep") {
    if (!isScheduledCall(ctx.request)) {
      if (!ctx.profile) throw new ValidationError("Not authenticated.");
      requireAdministrator(ctx.profile);
    }
    const result = await forfeitNoShows(body.tournamentId);
    return successResponse(result);
  }

  if (body.action === "open") {
    requireAdministrator(ctx.profile!);
    await openCheckIn(body.tournamentId);
    return successResponse({ opened: true });
  }

  requirePlayer(ctx.profile!);
  await checkIn(body.tournamentId, ctx.user!.id);
  return successResponse({ checked_in: true });
}

Deno.serve(
  withEdgeFunction(
    {
      functionName: "tournament-checkin",
      auth: "optional",
      rateLimit: (ctx) => ({
        key: `tournament-checkin:${ctx.user?.id ?? "scheduled"}`,
        windowSeconds: 60,
        maxRequests: 20,
      }),
    },
    handler,
  ),
);
