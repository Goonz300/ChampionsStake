// supabase/functions/wallet-adjustment/index.ts
//
// POST /wallet-adjustment — propose a wallet adjustment (first admin).
// PATCH /wallet-adjustment — approve a pending one (a DIFFERENT second admin).
// Both actions live in one function since they share the same resource;
// Deno.serve dispatches on request.method.

import { z } from "zod";
import {
  type EdgeContext,
  withEdgeFunction,
} from "../_shared/middleware/index.ts";
import { requireAdministrator } from "../_shared/permissions/index.ts";
import { parseJsonBody, validateBody } from "../_shared/validation/validate.ts";
import { successResponse } from "../_shared/response/index.ts";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../_shared/errors/index.ts";
import { getServiceRoleClient } from "../_shared/database/client.ts";
import { recordAudit } from "../_shared/audit/index.ts";
import { administrativeAdjustment } from "../_wallet/transfer.ts";

const proposeSchema = z.object({
  walletId: z.string().uuid(),
  amountCents: z.number().int().positive(),
  direction: z.enum(["credit", "debit"]),
  reason: z.string().min(10, "A reason of at least 10 characters is required."),
});

const approveSchema = z.object({
  requestId: z.string().uuid(),
});

async function handlePropose(ctx: EdgeContext): Promise<Response> {
  requireAdministrator(ctx.profile!);

  const body = validateBody(proposeSchema, await parseJsonBody(ctx.request));
  const supabase = getServiceRoleClient();

  const { data, error } = await supabase
    .from("wallet_adjustment_requests")
    .insert({
      wallet_id: body.walletId,
      amount_cents: body.amountCents,
      direction: body.direction === "credit" ? "credit" : "debit",
      reason: body.reason,
      proposed_by: ctx.user!.id,
    })
    .select("id, status")
    .single();

  if (error || !data) {
    throw new Error(`Failed to create adjustment request: ${error?.message}`);
  }

  await recordAudit({
    actorId: ctx.user!.id,
    actorType: "administrator",
    action: "WalletAdjustmentProposed",
    category: "financial",
    targetTable: "wallet_adjustment_requests",
    targetId: data.id,
    metadata: body,
  });

  return successResponse({ request_id: data.id, status: data.status }, {
    status: 202,
  });
}

async function handleApprove(ctx: EdgeContext): Promise<Response> {
  requireAdministrator(ctx.profile!);

  const body = validateBody(approveSchema, await parseJsonBody(ctx.request));
  const supabase = getServiceRoleClient();

  const { data: pending, error: fetchError } = await supabase
    .from("wallet_adjustment_requests")
    .select("*")
    .eq("id", body.requestId)
    .maybeSingle();

  if (fetchError || !pending) {
    throw new NotFoundError(`Adjustment request ${body.requestId} not found.`);
  }

  if (pending.status !== "pending_approval") {
    throw new ConflictError(
      `Adjustment request ${body.requestId} is already "${pending.status}".`,
    );
  }

  if (pending.proposed_by === ctx.user!.id) {
    throw new ValidationError(
      "A different administrator than the one who proposed this adjustment must approve it (four-eyes principle, Business Rules §11).",
    );
  }

  if (new Date(pending.expires_at) < new Date()) {
    await supabase.from("wallet_adjustment_requests").update({
      status: "expired",
    }).eq("id", pending.id);
    throw new ConflictError(
      `Adjustment request ${body.requestId} has expired. Propose a new one.`,
    );
  }

  const result = await administrativeAdjustment(
    pending.wallet_id,
    pending.amount_cents,
    pending.direction,
    pending.reason,
    [pending.proposed_by, ctx.user!.id],
    pending.id, // the adjustment request's own id is already a unique UUID — a natural, deterministic idempotency key
  );

  await supabase
    .from("wallet_adjustment_requests")
    .update({
      status: "approved",
      approved_by: ctx.user!.id,
      resulting_transaction_id: result.transactionId,
      decided_at: new Date().toISOString(),
    })
    .eq("id", pending.id);

  return successResponse({
    request_id: pending.id,
    status: "approved",
    transaction_id: result.transactionId,
  });
}

function handler(ctx: EdgeContext): Promise<Response> {
  if (ctx.request.method === "POST") return handlePropose(ctx);
  if (ctx.request.method === "PATCH") return handleApprove(ctx);

  throw new ValidationError(
    `Unsupported method ${ctx.request.method}. Use POST to propose or PATCH to approve.`,
  );
}

Deno.serve(
  withEdgeFunction(
    {
      functionName: "wallet-adjustment",
      auth: "required",
      rateLimit: (ctx) => ({
        key: `wallet-adjustment:${ctx.user!.id}`,
        windowSeconds: 60,
        maxRequests: 10,
      }),
    },
    handler,
  ),
);
