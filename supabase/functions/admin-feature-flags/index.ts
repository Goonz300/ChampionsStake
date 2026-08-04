// supabase/functions/admin-feature-flags/index.ts

import { z } from "npm:zod@3.24.1";
import { withEdgeFunction, type EdgeContext } from "../_shared/middleware/index.ts";
import { requireAdministrator } from "../_shared/permissions/index.ts";
import { validateBody, parseJsonBody } from "../_shared/validation/validate.ts";
import { successResponse } from "../_shared/response/index.ts";
import { ValidationError } from "../_shared/errors/index.ts";
import { listFeatureFlags, toggleFeatureFlag } from "../_admin/feature-flags.ts";

const bodySchema = z.object({ key: z.string().min(1), enabled: z.boolean() });

async function handler(ctx: EdgeContext): Promise<Response> {
  requireAdministrator(ctx.profile!);

  if (ctx.request.method === "GET") {
    return successResponse(await listFeatureFlags());
  }

  if (ctx.request.method === "PATCH") {
    const body = validateBody(bodySchema, await parseJsonBody(ctx.request));
    const result = await toggleFeatureFlag(body.key, body.enabled);
    return successResponse(result);
  }

  throw new ValidationError(`Unsupported method ${ctx.request.method}.`);
}

Deno.serve(withEdgeFunction({ functionName: "admin-feature-flags", auth: "required" }, handler));
