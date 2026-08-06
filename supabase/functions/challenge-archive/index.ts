// supabase/functions/challenge-archive/index.ts
// Scheduled sweep: archives completed/cancelled/expired challenges past a
// retention window (default 30 days), mirroring challenge-expire's pattern.

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
import { archiveChallenge } from "../_challenge/workflow.ts";
import { logger } from "../_shared/logger/index.ts";

const ARCHIVE_RETENTION_DAYS = 30;

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

  const cutoff = new Date(
    Date.now() - ARCHIVE_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const supabase = getServiceRoleClient();

  const { data: candidates, error } = await supabase
    .from("challenges")
    .select("id, completed_at, cancelled_at, expires_at")
    .in("status", ["completed", "cancelled", "expired"])
    .limit(500);

  if (error) {
    throw new Error(`Failed to query archivable challenges: ${error.message}`);
  }

  let archived = 0;
  const failures: string[] = [];

  for (const row of candidates ?? []) {
    const terminalAt = row.completed_at ?? row.cancelled_at ?? row.expires_at;
    if (!terminalAt || terminalAt > cutoff) continue;

    try {
      await archiveChallenge(row.id);
      archived += 1;
    } catch (err) {
      failures.push(row.id);
      logger.error("Failed to archive challenge", {
        challengeId: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return successResponse({
    candidates: (candidates ?? []).length,
    archived,
    failures,
  });
}

Deno.serve(
  withEdgeFunction(
    { functionName: "challenge-archive", auth: "optional" },
    handler,
  ),
);
