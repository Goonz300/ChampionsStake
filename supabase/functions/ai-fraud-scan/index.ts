// supabase/functions/ai-fraud-scan/index.ts
// GET: list flags (staff). POST with scheduled secret: sweep. PATCH: review a flag (staff).

import { z } from "zod";
import {
  type EdgeContext,
  withEdgeFunction,
} from "../_shared/middleware/index.ts";
import { requireModerator } from "../_shared/permissions/index.ts";
import {
  parseJsonBody,
  validateBody,
  validateQuery,
} from "../_shared/validation/validate.ts";
import { successResponse } from "../_shared/response/index.ts";
import {
  AuthenticationError,
  ValidationError,
} from "../_shared/errors/index.ts";
import { config } from "../_shared/config/index.ts";
import { timingSafeEqual } from "../_shared/security/signed-requests.ts";
import {
  listFraudFlags,
  reviewFlag,
  sweepRecentChallenges,
} from "../_ai/fraud-detection.ts";

const getQuerySchema = z.object({ status: z.string().optional() });
const patchSchema = z.object({
  flagId: z.string().uuid(),
  outcome: z.enum(["reviewed_cleared", "reviewed_confirmed"]),
});

function isScheduledCall(request: Request): boolean {
  const authHeader = request.headers.get("Authorization");
  const secret = config.security.scheduledJobSharedSecret;
  if (!secret || !authHeader) return false;
  return timingSafeEqual(authHeader, `Bearer ${secret}`);
}

async function handler(ctx: EdgeContext): Promise<Response> {
  if (ctx.request.method === "POST") {
    if (!isScheduledCall(ctx.request)) {
      if (!ctx.profile) throw new AuthenticationError("Not authenticated.");
      requireModerator(ctx.profile);
    }
    return successResponse(await sweepRecentChallenges());
  }

  requireModerator(ctx.profile!);

  if (ctx.request.method === "GET") {
    const url = new URL(ctx.request.url);
    const query = validateQuery(getQuerySchema, url);
    return successResponse(await listFraudFlags(query.status));
  }

  if (ctx.request.method === "PATCH") {
    const body = validateBody(patchSchema, await parseJsonBody(ctx.request));
    await reviewFlag(body.flagId, body.outcome, ctx.user!.id);
    return successResponse({ reviewed: true });
  }

  throw new ValidationError(`Unsupported method ${ctx.request.method}.`);
}

Deno.serve(
  withEdgeFunction(
    { functionName: "ai-fraud-scan", auth: "optional" },
    handler,
  ),
);
