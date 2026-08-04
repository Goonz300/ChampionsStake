// supabase/functions/moderator-decision/index.ts

import { z } from "npm:zod@3.24.1";
import { withEdgeFunction, type EdgeContext } from "../_shared/middleware/index.ts";
import { requireModerator } from "../_shared/permissions/index.ts";
import { validateBody, parseJsonBody } from "../_shared/validation/validate.ts";
import { successResponse } from "../_shared/response/index.ts";
import { ValidationError } from "../_shared/errors/index.ts";
import {
  approveWinner,
  approveOpponent,
  dismissInvalidDispute,
  voidMatch,
  requestMoreEvidence,
  returnToPlayers,
  reopenCase,
} from "../_moderator/decisions.ts";

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve_winner"), disputeId: z.string().uuid(), rationale: z.string().min(10) }),
  z.object({ action: z.literal("approve_opponent"), disputeId: z.string().uuid(), rationale: z.string().min(10) }),
  z.object({ action: z.literal("dismiss_invalid"), disputeId: z.string().uuid(), rationale: z.string().min(10) }),
  z.object({ action: z.literal("void_match"), disputeId: z.string().uuid(), rationale: z.string().min(10) }),
  z.object({
    action: z.literal("request_more_evidence"),
    disputeId: z.string().uuid(),
    extensionHours: z.number().int().positive().optional(),
  }),
  z.object({ action: z.literal("return_to_players"), disputeId: z.string().uuid(), note: z.string().min(1) }),
  z.object({ action: z.literal("reopen"), disputeId: z.string().uuid() }),
]);

async function handler(ctx: EdgeContext): Promise<Response> {
  requireModerator(ctx.profile!);
  const body = validateBody(bodySchema, await parseJsonBody(ctx.request));
  const moderatorId = ctx.user!.id;

  switch (body.action) {
    case "approve_winner":
      await approveWinner(body.disputeId, moderatorId, body.rationale);
      break;
    case "approve_opponent":
      await approveOpponent(body.disputeId, moderatorId, body.rationale);
      break;
    case "dismiss_invalid":
      await dismissInvalidDispute(body.disputeId, moderatorId, body.rationale);
      break;
    case "void_match":
      await voidMatch(body.disputeId, moderatorId, body.rationale);
      break;
    case "request_more_evidence":
      await requestMoreEvidence(body.disputeId, moderatorId, body.extensionHours);
      break;
    case "return_to_players":
      await returnToPlayers(body.disputeId, moderatorId, body.note);
      break;
    case "reopen":
      await reopenCase(body.disputeId, moderatorId);
      break;
    default:
      throw new ValidationError("Unsupported action.");
  }

  return successResponse({ processed: true });
}

Deno.serve(withEdgeFunction({ functionName: "moderator-decision", auth: "required" }, handler));
