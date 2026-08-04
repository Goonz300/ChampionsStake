// supabase/functions/admin-announcements/index.ts

import { z } from "npm:zod@3.24.1";
import { withEdgeFunction, type EdgeContext } from "../_shared/middleware/index.ts";
import { requireAdministrator } from "../_shared/permissions/index.ts";
import { validateBody, validateQuery, parseJsonBody } from "../_shared/validation/validate.ts";
import { successResponse } from "../_shared/response/index.ts";
import { ValidationError } from "../_shared/errors/index.ts";
import { createAnnouncement, publishAnnouncement, retractAnnouncement, listAnnouncements } from "../_admin/announcements.ts";

const createSchema = z.object({
  category: z.enum(["platform_notice", "maintenance", "tournament", "emergency"]),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(5000),
  expiresAt: z.string().datetime({ offset: true }).optional(),
});

const actionSchema = z.object({ action: z.enum(["publish", "retract"]), announcementId: z.string().uuid() });
const getQuerySchema = z.object({ status: z.string().optional() });

async function handler(ctx: EdgeContext): Promise<Response> {
  requireAdministrator(ctx.profile!);

  if (ctx.request.method === "GET") {
    const url = new URL(ctx.request.url);
    const query = validateQuery(getQuerySchema, url);
    return successResponse(await listAnnouncements(query.status));
  }

  if (ctx.request.method === "POST") {
    const body = validateBody(createSchema, await parseJsonBody(ctx.request));
    const result = await createAnnouncement(body, ctx.user!.id);
    return successResponse(result, { status: 201 });
  }

  if (ctx.request.method === "PATCH") {
    const body = validateBody(actionSchema, await parseJsonBody(ctx.request));
    if (body.action === "publish") {
      await publishAnnouncement(body.announcementId, ctx.user!.id);
    } else {
      await retractAnnouncement(body.announcementId, ctx.user!.id);
    }
    return successResponse({ updated: true });
  }

  throw new ValidationError(`Unsupported method ${ctx.request.method}.`);
}

Deno.serve(withEdgeFunction({ functionName: "admin-announcements", auth: "required" }, handler));
