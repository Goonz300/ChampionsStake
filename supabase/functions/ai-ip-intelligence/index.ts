// supabase/functions/ai-ip-intelligence/index.ts
// Scheduled sweep (or admin-triggered), mirroring ai-trust-score/ai-fraud-scan's
// dual admin-or-scheduled-secret pattern.

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
  backfillIpClassification,
  refreshDatacenterRanges,
  refreshTorExitNodes,
} from "../_ai/ip-intelligence.ts";

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

  const [tor, datacenter, backfill] = await Promise.all([
    refreshTorExitNodes(),
    refreshDatacenterRanges(),
    backfillIpClassification(),
  ]);

  return successResponse({ tor, datacenter, backfill });
}

Deno.serve(
  withEdgeFunction(
    {
      functionName: "ai-ip-intelligence",
      auth: "optional",
      rateLimit: (ctx) => ({
        key: `ai-ip-intelligence:${ctx.user?.id ?? "scheduled"}`,
        windowSeconds: 60,
        maxRequests: 5,
      }),
    },
    handler,
  ),
);
