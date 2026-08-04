// supabase/functions/admin-audit/index.ts

import { z } from "npm:zod@3.24.1";
import { withEdgeFunction, type EdgeContext } from "../_shared/middleware/index.ts";
import { requireAdministrator } from "../_shared/permissions/index.ts";
import { validateQuery } from "../_shared/validation/validate.ts";
import { paginationQuerySchema } from "../_shared/validation/schemas.ts";
import { successResponse } from "../_shared/response/index.ts";
import { searchAuditLogs } from "../_admin/audit.ts";

const querySchema = paginationQuerySchema.extend({
  actorId: z.string().uuid().optional(),
  targetTable: z.string().optional(),
  targetId: z.string().optional(),
  action: z.string().optional(),
  category: z.string().optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

async function handler(ctx: EdgeContext): Promise<Response> {
  requireAdministrator(ctx.profile!);
  const url = new URL(ctx.request.url);
  const query = validateQuery(querySchema, url);

  const results = await searchAuditLogs(query);
  return successResponse(results);
}

Deno.serve(withEdgeFunction({ functionName: "admin-audit", auth: "required" }, handler));
