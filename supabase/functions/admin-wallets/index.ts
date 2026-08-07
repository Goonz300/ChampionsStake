// supabase/functions/admin-wallets/index.ts

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
import { paginationQuerySchema } from "../_shared/validation/schemas.ts";
import { successResponse } from "../_shared/response/index.ts";
import { ValidationError } from "../_shared/errors/index.ts";
import {
  adminAddSanctionsBlocklistEntry,
  adminApproveWithdrawal,
  adminExportStatement,
  adminFreezeWallet,
  adminGetBalance,
  adminGetLedger,
  adminGetTransactions,
  adminListPendingReviewWithdrawals,
  adminListSanctionsBlocklist,
  adminRejectWithdrawal,
  adminRemoveSanctionsBlocklistEntry,
  adminUnfreezeWallet,
} from "../_admin/wallets.ts";

const getQuerySchema = paginationQuerySchema.extend({
  view: z.enum([
    "balance",
    "transactions",
    "ledger",
    "statement",
    "pending_review_withdrawals",
    "sanctions_blocklist",
  ]).default("balance"),
  userId: z.string().uuid().optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  format: z.enum(["json", "csv"]).default("json"),
});

const postBodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("freeze"),
    walletId: z.string().uuid(),
    reason: z.string().min(1),
  }),
  z.object({ action: z.literal("unfreeze"), walletId: z.string().uuid() }),
  z.object({
    action: z.literal("approve_withdrawal"),
    intentId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("reject_withdrawal"),
    intentId: z.string().uuid(),
    reason: z.string().min(1),
  }),
  z.object({
    action: z.literal("add_sanctions_blocklist_entry"),
    fullName: z.string().min(1),
    reason: z.string().min(1),
  }),
  z.object({
    action: z.literal("remove_sanctions_blocklist_entry"),
    entryId: z.string().uuid(),
  }),
]);

async function handleGet(ctx: EdgeContext): Promise<Response> {
  const url = new URL(ctx.request.url);
  const query = validateQuery(getQuerySchema, url);

  if (query.view === "pending_review_withdrawals") {
    return successResponse(
      await adminListPendingReviewWithdrawals(query.limit),
    );
  }
  if (query.view === "sanctions_blocklist") {
    return successResponse(await adminListSanctionsBlocklist(query.limit));
  }

  if (!query.userId) {
    throw new ValidationError(`userId is required for the ${query.view} view.`);
  }

  if (query.view === "balance") {
    return successResponse(await adminGetBalance(query.userId));
  }
  if (query.view === "transactions") {
    return successResponse(
      await adminGetTransactions(query.userId, query.limit, query.cursor),
    );
  }
  if (query.view === "ledger") {
    return successResponse(await adminGetLedger(query.userId, query.limit));
  }

  if (!query.from || !query.to) {
    throw new ValidationError(
      "from and to are required for the statement view.",
    );
  }
  const statement = await adminExportStatement(
    query.userId,
    query.from,
    query.to,
    query.format,
  );

  if (query.format === "csv") {
    return new Response(statement as string, {
      status: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": "attachment; filename=statement.csv",
      },
    });
  }
  return successResponse(statement);
}

async function handlePost(ctx: EdgeContext): Promise<Response> {
  const body = validateBody(postBodySchema, await parseJsonBody(ctx.request));

  if (body.action === "freeze") {
    await adminFreezeWallet(body.walletId, body.reason, ctx.user!.id);
    return successResponse({ frozen: true });
  }
  if (body.action === "unfreeze") {
    await adminUnfreezeWallet(body.walletId, ctx.user!.id);
    return successResponse({ unfrozen: true });
  }
  if (body.action === "approve_withdrawal") {
    const result = await adminApproveWithdrawal(body.intentId, ctx.user!.id);
    return successResponse({ approved: true, ...result });
  }
  if (body.action === "reject_withdrawal") {
    await adminRejectWithdrawal(body.intentId, ctx.user!.id, body.reason);
    return successResponse({ rejected: true });
  }
  if (body.action === "add_sanctions_blocklist_entry") {
    const result = await adminAddSanctionsBlocklistEntry(
      body.fullName,
      body.reason,
      ctx.user!.id,
    );
    return successResponse(result, { status: 201 });
  }

  await adminRemoveSanctionsBlocklistEntry(body.entryId, ctx.user!.id);
  return successResponse({ removed: true });
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
      functionName: "admin-wallets",
      auth: "required",
      rateLimit: (ctx) => ({
        key: `admin-wallets:${ctx.user!.id}`,
        windowSeconds: 60,
        maxRequests: 30,
      }),
    },
    handler,
  ),
);
