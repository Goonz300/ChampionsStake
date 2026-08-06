// supabase/functions/admin-system-health/index.ts
// Also serves the Dashboard and Analytics API requirements via ?view= --
// consolidating read-only aggregation endpoints behind one function,
// consistent with the tournament-browse/admin-wallets pattern established
// in prior phases, rather than one tiny function per metric.

import { z } from "zod";
import {
  type EdgeContext,
  withEdgeFunction,
} from "../_shared/middleware/index.ts";
import { requireAdministrator } from "../_shared/permissions/index.ts";
import { validateQuery } from "../_shared/validation/validate.ts";
import { successResponse } from "../_shared/response/index.ts";
import { getSystemHealth } from "../_admin/system-health.ts";
import { getDashboardMetrics } from "../_admin/dashboard.ts";
import * as analytics from "../_admin/analytics.ts";

const querySchema = z.object({
  view: z
    .enum([
      "health",
      "dashboard",
      "user_growth",
      "challenge_volume",
      "tournament_volume",
      "revenue",
      "escrow_stats",
      "retention",
      "disputes",
    ])
    .default("health"),
  days: z.coerce.number().int().positive().max(365).default(30),
});

async function handler(ctx: EdgeContext): Promise<Response> {
  requireAdministrator(ctx.profile!);
  const url = new URL(ctx.request.url);
  const query = validateQuery(querySchema, url);

  switch (query.view) {
    case "health":
      return successResponse(await getSystemHealth());
    case "dashboard":
      return successResponse(await getDashboardMetrics());
    case "user_growth":
      return successResponse(await analytics.userGrowth(query.days));
    case "challenge_volume":
      return successResponse(await analytics.challengeVolume(query.days));
    case "tournament_volume":
      return successResponse(await analytics.tournamentVolume(query.days));
    case "revenue":
      return successResponse(await analytics.revenue(query.days));
    case "escrow_stats":
      return successResponse(await analytics.escrowStatistics());
    case "retention":
      return successResponse(await analytics.retentionProxy());
    case "disputes":
      return successResponse(await analytics.disputeStatistics(query.days));
  }
}

Deno.serve(
  withEdgeFunction(
    {
      functionName: "admin-system-health",
      auth: "required",
      rateLimit: (ctx) => ({
        key: `admin-system-health:${ctx.user!.id}`,
        windowSeconds: 60,
        maxRequests: 30,
      }),
    },
    handler,
  ),
);
