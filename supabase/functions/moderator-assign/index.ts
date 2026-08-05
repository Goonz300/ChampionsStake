// supabase/functions/moderator-assign/index.ts

import { z } from "npm:zod@3.24.1";
import {
  type EdgeContext,
  withEdgeFunction,
} from "../_shared/middleware/index.ts";
import {
  requireAdministrator,
  requireModerator,
} from "../_shared/permissions/index.ts";
import { parseJsonBody, validateBody } from "../_shared/validation/validate.ts";
import { successResponse } from "../_shared/response/index.ts";
import { ValidationError } from "../_shared/errors/index.ts";
import {
  assignDispute,
  autoAssign,
  claimDispute,
  escalateDispute,
  setPriority,
} from "../_moderator/queue.ts";

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("auto_assign"), disputeId: z.string().uuid() }),
  z.object({
    action: z.literal("assign"),
    disputeId: z.string().uuid(),
    moderatorId: z.string().uuid(),
  }),
  z.object({ action: z.literal("claim"), disputeId: z.string().uuid() }),
  z.object({
    action: z.literal("set_priority"),
    disputeId: z.string().uuid(),
    priority: z.enum(["low", "normal", "high", "urgent"]),
  }),
  z.object({
    action: z.literal("escalate"),
    disputeId: z.string().uuid(),
    adminId: z.string().uuid(),
    reason: z.string().min(1),
  }),
]);

async function handler(ctx: EdgeContext): Promise<Response> {
  requireModerator(ctx.profile!);
  const body = validateBody(bodySchema, await parseJsonBody(ctx.request));

  switch (body.action) {
    case "auto_assign":
      return successResponse({ assignedTo: await autoAssign(body.disputeId) });
    case "assign":
      requireAdministrator(ctx.profile!);
      await assignDispute(body.disputeId, body.moderatorId, ctx.user!.id);
      return successResponse({ assigned: true });
    case "claim":
      await claimDispute(body.disputeId, ctx.user!.id);
      return successResponse({ claimed: true });
    case "set_priority":
      await setPriority(body.disputeId, body.priority, ctx.user!.id);
      return successResponse({ updated: true });
    case "escalate":
      await escalateDispute(
        body.disputeId,
        body.adminId,
        ctx.user!.id,
        body.reason,
      );
      return successResponse({ escalated: true });
    default:
      throw new ValidationError("Unsupported action.");
  }
}

Deno.serve(
  withEdgeFunction(
    { functionName: "moderator-assign", auth: "required" },
    handler,
  ),
);
