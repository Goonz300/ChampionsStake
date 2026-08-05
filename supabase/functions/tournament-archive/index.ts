// supabase/functions/tournament-archive/index.ts
// Scheduled sweep, mirroring challenge-archive's pattern exactly.

import {
  type EdgeContext,
  withEdgeFunction,
} from "../_shared/middleware/index.ts";
import { requireAdministrator } from "../_shared/permissions/index.ts";
import { successResponse } from "../_shared/response/index.ts";
import { AuthenticationError } from "../_shared/errors/index.ts";
import { config } from "../_shared/config/index.ts";
import { getServiceRoleClient } from "../_shared/database/client.ts";
import { archiveTournament } from "../_tournament/workflow.ts";
import { logger } from "../_shared/logger/index.ts";

const ARCHIVE_RETENTION_DAYS = 30;

function isScheduledCall(request: Request): boolean {
  const authHeader = request.headers.get("Authorization");
  const secret = config.security.scheduledJobSharedSecret;
  return Boolean(secret) && authHeader === `Bearer ${secret}`;
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
    .from("tournaments")
    .select("id, updated_at")
    .in("status", ["completed", "cancelled"])
    .lt("updated_at", cutoff)
    .limit(200);

  if (error) {
    throw new Error(`Failed to query archivable tournaments: ${error.message}`);
  }

  let archived = 0;
  const failures: string[] = [];

  for (const row of candidates ?? []) {
    try {
      await archiveTournament(row.id);
      archived += 1;
    } catch (err) {
      failures.push(row.id);
      logger.error("Failed to archive tournament", {
        tournamentId: row.id,
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
    { functionName: "tournament-archive", auth: "optional" },
    handler,
  ),
);
