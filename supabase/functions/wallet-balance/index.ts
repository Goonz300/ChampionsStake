// supabase/functions/wallet-balance/index.ts
//
// GET /wallet-balance — returns the caller's own balance, or (with
// requireSupportStaff) another user's, via ?userId=.

import { withEdgeFunction, type EdgeContext } from "../_shared/middleware/index.ts";
import { requirePlayer, requireSupportStaff } from "../_shared/permissions/index.ts";
import { successResponse } from "../_shared/response/index.ts";
import { getBalance } from "../_wallet/service.ts";

async function handler(ctx: EdgeContext): Promise<Response> {
  const url = new URL(ctx.request.url);
  const requestedUserId = url.searchParams.get("userId");

  let targetUserId = ctx.user!.id;

  if (requestedUserId && requestedUserId !== ctx.user!.id) {
    requireSupportStaff(ctx.profile!);
    targetUserId = requestedUserId;
  } else {
    requirePlayer(ctx.profile!);
  }

  const balance = await getBalance(targetUserId);

  return successResponse({
    wallet_id: balance.walletId,
    status: balance.status,
    currency: balance.currency,
    available_cents: balance.availableCents,
    escrowed_cents: balance.escrowedCents,
    pending_cents: balance.pendingCents,
    bonus_cents: balance.bonusCents,
    referral_cents: balance.referralCents,
  });
}

Deno.serve(
  withEdgeFunction(
    {
      functionName: "wallet-balance",
      auth: "required",
      rateLimit: (ctx) => ({ key: `wallet-balance:${ctx.user?.id}`, windowSeconds: 60, maxRequests: 60 }),
    },
    handler,
  ),
);
