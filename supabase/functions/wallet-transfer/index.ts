// supabase/functions/wallet-transfer/index.ts
//
// POST /wallet-transfer — exposes the low-level transfer primitives from
// _wallet/transfer.ts over HTTP.
//
// SCOPE NOTE: every kind here is gated behind requireAdministrator. Business
// Rules and the API Specification never describe a player-facing
// "send money to another player" feature — the only wallet-affecting
// actions a player takes are deposit/withdraw (Payments phase, not this
// one) and, in the future, challenge stake lock/release (Escrow Engine
// phase, which will call lockToEscrow/releaseFromEscrow directly from its
// own Edge Functions rather than through this HTTP endpoint, since it needs
// to coordinate that with challenge-state changes atomically). This
// function is therefore effectively an admin/ops tool today; opening any
// kind of transfer to ordinary players is a product decision for a future
// phase to make deliberately, not something to assume here.

import { z } from "zod";
import {
  type EdgeContext,
  withEdgeFunction,
} from "../_shared/middleware/index.ts";
import { requireAdministrator } from "../_shared/permissions/index.ts";
import { parseJsonBody, validateBody } from "../_shared/validation/validate.ts";
import {
  idempotencyKeyHeaderSchema,
  moneyAmountCentsSchema,
} from "../_shared/validation/schemas.ts";
import { successResponse } from "../_shared/response/index.ts";
import {
  beginIdempotentRequest,
  completeIdempotentRequest,
  failIdempotentRequest,
} from "../_shared/idempotency/index.ts";
import { platformToWallet, walletToWallet } from "../_wallet/transfer.ts";

const bodySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("wallet_to_wallet"),
    fromWalletId: z.string().uuid(),
    toWalletId: z.string().uuid(),
    amountCents: moneyAmountCentsSchema,
  }),
  z.object({
    kind: z.literal("platform_to_wallet"),
    toWalletId: z.string().uuid(),
    amountCents: moneyAmountCentsSchema,
    transactionType: z.enum(["bonus_credit", "tournament_prize"]),
  }),
]);

async function handler(ctx: EdgeContext): Promise<Response> {
  requireAdministrator(ctx.profile!);

  const idempotencyKey = idempotencyKeyHeaderSchema.parse(
    ctx.request.headers.get("Idempotency-Key"),
  );
  const body = validateBody(bodySchema, await parseJsonBody(ctx.request));

  const idempotency = await beginIdempotentRequest<Record<string, unknown>>(
    idempotencyKey,
    "wallet-transfer",
    body,
  );
  if (idempotency.kind === "replayed") {
    return successResponse(idempotency.response.body, {
      status: idempotency.response.statusCode,
    });
  }

  try {
    const result = body.kind === "wallet_to_wallet"
      ? await walletToWallet(
        body.fromWalletId,
        body.toWalletId,
        body.amountCents,
        ctx.user!.id,
        idempotencyKey,
      )
      : await platformToWallet(
        body.toWalletId,
        body.amountCents,
        body.transactionType,
        ctx.user!.id,
        idempotencyKey,
      );

    const responseBody = {
      transaction_id: result.transactionId,
      status: result.status,
    };
    await completeIdempotentRequest(idempotencyKey, 201, responseBody);
    return successResponse(responseBody, { status: 201 });
  } catch (err) {
    await failIdempotentRequest(idempotencyKey);
    throw err;
  }
}

Deno.serve(
  withEdgeFunction(
    {
      functionName: "wallet-transfer",
      auth: "required",
      rateLimit: (ctx) => ({
        key: `wallet-transfer:${ctx.user?.id}`,
        windowSeconds: 60,
        maxRequests: 20,
      }),
    },
    handler,
  ),
);
