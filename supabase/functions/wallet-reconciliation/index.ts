// supabase/functions/wallet-reconciliation/index.ts
//
// POST /wallet-reconciliation — runs a full reconciliation sweep. Callable
// two ways: (1) by an administrator via the dashboard/API (JWT auth), or
// (2) by a scheduled pg_cron job via a shared-secret header, following the
// exact pattern STORE-001's storage-cleanup function established. This
// function does not schedule itself — see EDGE_FUNCTIONS.md /
// WALLET-001-deliverable.md for the pg_cron wiring, which mirrors migration
// 0033 from STORE-001.

import {
  type EdgeContext,
  withEdgeFunction,
} from "../_shared/middleware/index.ts";
import { requireAdministrator } from "../_shared/permissions/index.ts";
import { successResponse } from "../_shared/response/index.ts";
import { AuthenticationError } from "../_shared/errors/index.ts";
import { config } from "../_shared/config/index.ts";
import { timingSafeEqual } from "../_shared/security/signed-requests.ts";
import { runReconciliation } from "../_wallet/reconciliation.ts";

function isValidScheduledCall(request: Request): boolean {
  const authHeader = request.headers.get("Authorization");
  const expectedSecret = config.security.scheduledJobSharedSecret;
  if (!expectedSecret || !authHeader) return false;
  return timingSafeEqual(authHeader, `Bearer ${expectedSecret}`);
}

async function handler(ctx: EdgeContext): Promise<Response> {
  const isScheduled = isValidScheduledCall(ctx.request);

  if (!isScheduled) {
    if (!ctx.profile) throw new AuthenticationError("Not authenticated.");
    requireAdministrator(ctx.profile);
  }

  const result = await runReconciliation(isScheduled ? null : ctx.user!.id);

  return successResponse({
    run_id: result.runId,
    wallets_checked: result.walletsChecked,
    mismatches_found: result.mismatchesFound,
    wallets_frozen: result.walletsFrozen,
  });
}

Deno.serve(
  withEdgeFunction(
    // auth: "optional" so the scheduled-call path (no user JWT at all, just
    // the shared secret) doesn't get rejected before handler() can check
    // isValidScheduledCall — the handler itself enforces one of the two
    // valid auth paths, never falling through to "neither".
    {
      functionName: "wallet-reconciliation",
      auth: "optional",
      rateLimit: (ctx) => ({
        key: `wallet-reconciliation:${ctx.user?.id ?? "scheduled"}`,
        windowSeconds: 60,
        maxRequests: 5,
      }),
    },
    handler,
  ),
);
