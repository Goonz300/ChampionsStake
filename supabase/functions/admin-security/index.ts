// supabase/functions/admin-security/index.ts
// Layer 16 (Administration): blocked/locked accounts, rate-limit/abuse
// stats, fraud flag review, account unlock. Consolidated behind ?view=/
// action= like admin-system-health and admin-wallets, rather than one tiny
// function per concern.

import { z } from "zod";
import {
  type EdgeContext,
  withEdgeFunction,
} from "../_shared/middleware/index.ts";
import { requireAdministrator } from "../_shared/permissions/index.ts";
import {
  parseJsonBody,
  validateBody,
  validateQuery,
} from "../_shared/validation/validate.ts";
import { successResponse } from "../_shared/response/index.ts";
import { ValidationError } from "../_shared/errors/index.ts";
import {
  getAbuseStats,
  listLockedAccounts,
  unlockAccount,
} from "../_admin/security.ts";
import { listFraudFlags, reviewFlag } from "../_ai/fraud-detection.ts";

const getQuerySchema = z.object({
  view: z.enum(["locked_accounts", "fraud_flags", "abuse_stats"]).default(
    "abuse_stats",
  ),
  status: z.enum(["open", "reviewed_cleared", "reviewed_confirmed"])
    .optional(),
  hours: z.coerce.number().int().positive().max(24 * 30).default(24),
  limit: z.coerce.number().int().positive().max(200).default(50),
});

const postBodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("unlock_account"), email: z.string().email() }),
  z.object({
    action: z.literal("review_fraud_flag"),
    flagId: z.string().uuid(),
    outcome: z.enum(["reviewed_cleared", "reviewed_confirmed"]),
  }),
]);

async function handleGet(ctx: EdgeContext): Promise<Response> {
  const url = new URL(ctx.request.url);
  const query = validateQuery(getQuerySchema, url);

  if (query.view === "locked_accounts") {
    return successResponse(await listLockedAccounts(query.limit));
  }
  if (query.view === "fraud_flags") {
    return successResponse(await listFraudFlags(query.status));
  }
  return successResponse(await getAbuseStats(query.hours));
}

async function handlePost(ctx: EdgeContext): Promise<Response> {
  const body = validateBody(postBodySchema, await parseJsonBody(ctx.request));

  if (body.action === "unlock_account") {
    await unlockAccount(body.email, ctx.user!.id);
    return successResponse({ unlocked: true });
  }

  await reviewFlag(body.flagId, body.outcome, ctx.user!.id);
  return successResponse({ reviewed: true });
}

function handler(ctx: EdgeContext): Promise<Response> {
  requireAdministrator(ctx.profile!);
  if (ctx.request.method === "GET") return handleGet(ctx);
  if (ctx.request.method === "POST") return handlePost(ctx);
  throw new ValidationError(`Unsupported method ${ctx.request.method}.`);
}

Deno.serve(
  withEdgeFunction(
    {
      functionName: "admin-security",
      auth: "required",
      rateLimit: (ctx) => ({
        key: `admin-security:${ctx.user!.id}`,
        windowSeconds: 60,
        maxRequests: 30,
      }),
    },
    handler,
  ),
);
