// supabase/functions/wallet-create/index.ts
//
// POST /wallet-create — administrator-only recovery path. Normal wallet
// creation happens automatically via AUTH-001's fn_handle_new_user()
// trigger; this exists only for the edge case where that somehow didn't
// happen (see service.ts's createWalletIfMissing header comment).

import { z } from "npm:zod@3.24.1";
import { withEdgeFunction, type EdgeContext } from "../_shared/middleware/index.ts";
import { requireAdministrator } from "../_shared/permissions/index.ts";
import { validateBody, parseJsonBody } from "../_shared/validation/validate.ts";
import { successResponse } from "../_shared/response/index.ts";
import { createWalletIfMissing } from "../_wallet/service.ts";

const bodySchema = z.object({ userId: z.string().uuid() });

async function handler(ctx: EdgeContext): Promise<Response> {
  requireAdministrator(ctx.profile!);

  const body = validateBody(bodySchema, await parseJsonBody(ctx.request));
  const wallet = await createWalletIfMissing(body.userId, ctx.user!.id);

  return successResponse(
    { wallet_id: wallet.walletId, user_id: wallet.userId, status: wallet.status },
    { status: 201 },
  );
}

Deno.serve(
  withEdgeFunction(
    { functionName: "wallet-create", auth: "required" },
    handler,
  ),
);
