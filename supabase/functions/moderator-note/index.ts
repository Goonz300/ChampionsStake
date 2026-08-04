// supabase/functions/moderator-note/index.ts

import { z } from "npm:zod@3.24.1";
import { withEdgeFunction, type EdgeContext } from "../_shared/middleware/index.ts";
import { requireModerator } from "../_shared/permissions/index.ts";
import { validateBody, validateQuery, parseJsonBody } from "../_shared/validation/validate.ts";
import { successResponse } from "../_shared/response/index.ts";
import { ValidationError } from "../_shared/errors/index.ts";
import { addNote, listNotes } from "../_moderator/notes.ts";

const postSchema = z.object({ disputeId: z.string().uuid(), content: z.string().min(1).max(5000) });
const getSchema = z.object({ disputeId: z.string().uuid() });

async function handler(ctx: EdgeContext): Promise<Response> {
  requireModerator(ctx.profile!);

  if (ctx.request.method === "GET") {
    const url = new URL(ctx.request.url);
    const query = validateQuery(getSchema, url);
    return successResponse(await listNotes(query.disputeId));
  }

  if (ctx.request.method === "POST") {
    const body = validateBody(postSchema, await parseJsonBody(ctx.request));
    const result = await addNote(body.disputeId, ctx.user!.id, body.content);
    return successResponse(result, { status: 201 });
  }

  throw new ValidationError(`Unsupported method ${ctx.request.method}.`);
}

Deno.serve(withEdgeFunction({ functionName: "moderator-note", auth: "required" }, handler));
