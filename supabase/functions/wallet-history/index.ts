// supabase/functions/wallet-history/index.ts
//
// GET /wallet-history — paginated transaction history for the caller's own
// wallet, or (with requireSupportStaff) another user's via ?userId=.
// Also serves as the "Get Statement" API when ?format=statement is passed.

import { z } from "npm:zod@3.24.1";
import { withEdgeFunction, type EdgeContext } from "../_shared/middleware/index.ts";
import { requirePlayer, requireSupportStaff } from "../_shared/permissions/index.ts";
import { validateQuery } from "../_shared/validation/validate.ts";
import { paginationQuerySchema, isoDateSchema } from "../_shared/validation/schemas.ts";
import { successResponse, paginatedResponse } from "../_shared/response/index.ts";
import { getWalletByUserIdOrThrow } from "../_wallet/repository.ts";
import { listTransactions } from "../_wallet/repository.ts";
import { generateStatement, statementToCsv } from "../_wallet/statements.ts";

const querySchema = paginationQuerySchema.extend({
  userId: z.string().uuid().optional(),
  type: z.string().optional(),
  status: z.string().optional(),
  format: z.enum(["list", "statement", "csv"]).default("list"),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});

async function handler(ctx: EdgeContext): Promise<Response> {
  const url = new URL(ctx.request.url);
  const query = validateQuery(querySchema, url);

  let targetUserId = ctx.user!.id;
  if (query.userId && query.userId !== ctx.user!.id) {
    requireSupportStaff(ctx.profile!);
    targetUserId = query.userId;
  } else {
    requirePlayer(ctx.profile!);
  }

  const wallet = await getWalletByUserIdOrThrow(targetUserId);

  if (query.format === "list") {
    const transactions = await listTransactions({
      walletId: wallet.walletId,
      type: query.type,
      status: query.status,
      fromDate: query.from,
      toDate: query.to,
      cursor: query.cursor,
      limit: query.limit,
    });

    const nextCursor =
      transactions.length === query.limit
        ? ((transactions[transactions.length - 1] as { created_at: string } | undefined)?.created_at ?? null)
        : null;

    return paginatedResponse(transactions, { next_cursor: nextCursor });
  }

  const from = query.from ?? new Date(0).toISOString();
  const to = query.to ?? new Date().toISOString();
  const statement = await generateStatement(wallet.walletId, from, to);

  if (query.format === "csv") {
    return new Response(statementToCsv(statement), {
      status: 200,
      headers: { "Content-Type": "text/csv", "Content-Disposition": "attachment; filename=statement.csv" },
    });
  }

  return successResponse(statement);
}

Deno.serve(
  withEdgeFunction(
    {
      functionName: "wallet-history",
      auth: "required",
      rateLimit: (ctx) => ({ key: `wallet-history:${ctx.user?.id}`, windowSeconds: 60, maxRequests: 30 }),
    },
    handler,
  ),
);
