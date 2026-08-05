// supabase/functions/moderator-dashboard/index.ts
// Consolidates Dispute Queue, Case Details, Evidence, and Analytics reads
// behind one function via ?view=, the same consolidation pattern used by
// tournament-browse/admin-system-health in prior phases.

import { z } from "npm:zod@3.24.1";
import {
  type EdgeContext,
  withEdgeFunction,
} from "../_shared/middleware/index.ts";
import { requireModerator } from "../_shared/permissions/index.ts";
import { validateQuery } from "../_shared/validation/validate.ts";
import { successResponse } from "../_shared/response/index.ts";
import { ValidationError } from "../_shared/errors/index.ts";
import { getQueue } from "../_moderator/repository.ts";
import { getCaseDetail, getEvidenceList } from "../_moderator/cases.ts";
import { moderatorAnalytics } from "../_moderator/analytics.ts";

const querySchema = z.object({
  view: z.enum(["queue", "case", "evidence", "analytics"]).default("queue"),
  disputeId: z.string().uuid().optional(),
  days: z.coerce.number().int().positive().max(365).default(30),
});

async function handler(ctx: EdgeContext): Promise<Response> {
  requireModerator(ctx.profile!);
  const url = new URL(ctx.request.url);
  const query = validateQuery(querySchema, url);
  const isAdmin = ctx.profile!.role === "administrator";

  if (query.view === "queue") return successResponse(await getQueue());
  if (query.view === "analytics") {
    return successResponse(await moderatorAnalytics(query.days));
  }

  if (!query.disputeId) {
    throw new ValidationError("disputeId is required for case/evidence views.");
  }

  if (query.view === "case") {
    return successResponse(
      await getCaseDetail(query.disputeId, ctx.user!.id, isAdmin),
    );
  }
  return successResponse(await getEvidenceList(query.disputeId));
}

Deno.serve(
  withEdgeFunction(
    { functionName: "moderator-dashboard", auth: "required" },
    handler,
  ),
);
