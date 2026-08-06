// supabase/functions/challenge-expire/index.ts
// Scheduled sweep: finds every published/waiting challenge past its
// expires_at with no opponent, and expires each one (refunding the
// creator). Mirrors wallet-reconciliation's dual auth path (admin OR
// scheduled shared secret).

import {
  type EdgeContext,
  withEdgeFunction,
} from "../_shared/middleware/index.ts";
import { requireAdministrator } from "../_shared/permissions/index.ts";
import { successResponse } from "../_shared/response/index.ts";
import { AuthenticationError } from "../_shared/errors/index.ts";
import { config } from "../_shared/config/index.ts";
import { timingSafeEqual } from "../_shared/security/signed-requests.ts";
import { getServiceRoleClient } from "../_shared/database/client.ts";
import { expireChallenge } from "../_challenge/workflow.ts";
import { logger } from "../_shared/logger/index.ts";

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

  const supabase = getServiceRoleClient();
  const { data: expiredCandidates, error } = await supabase
    .from("challenges")
    .select("id")
    .in("status", ["published", "waiting"])
    .lt("expires_at", new Date().toISOString())
    .limit(500);

  if (error) {
    throw new Error(`Failed to query expirable challenges: ${error.message}`);
  }

  let expired = 0;
  const failures: string[] = [];

  for (const row of expiredCandidates ?? []) {
    try {
      await expireChallenge(row.id);
      expired += 1;
    } catch (err) {
      failures.push(row.id);
      logger.error("Failed to expire challenge", {
        challengeId: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return successResponse({
    candidates: (expiredCandidates ?? []).length,
    expired,
    failures,
  });
}

Deno.serve(
  withEdgeFunction(
    {
      functionName: "challenge-expire",
      auth: "optional",
      rateLimit: (ctx) => ({
        key: `challenge-expire:${ctx.user?.id ?? "scheduled"}`,
        windowSeconds: 60,
        maxRequests: 5,
      }),
    },
    handler,
  ),
);
