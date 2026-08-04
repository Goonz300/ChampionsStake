// supabase/functions/_template/index.ts
//
// TEMPLATE — copy this directory to start a new Edge Function. Rename the
// folder (which becomes the function's URL path) and replace the body of
// `handler` with real business logic. Everything above `handler` is
// boilerplate every function should keep as-is.
//
// This file intentionally contains NO business logic of its own (an "echo"
// endpoint that validates and reflects input back) — it exists purely to
// demonstrate that every framework piece from this phase composes
// correctly: auth, permissions, validation, idempotency, a transaction,
// audit, an emitted event, and a standard response, all in one place.

import { z } from "npm:zod@3.24.1";
import { withEdgeFunction, type EdgeContext } from "../_shared/middleware/index.ts";
import { validateBody, parseJsonBody } from "../_shared/validation/validate.ts";
import { requirePlayer } from "../_shared/permissions/index.ts";
import { successResponse } from "../_shared/response/index.ts";
import { ValidationError } from "../_shared/errors/index.ts";
import {
  beginIdempotentRequest,
  completeIdempotentRequest,
  failIdempotentRequest,
} from "../_shared/idempotency/index.ts";
import { withTransaction } from "../_shared/transactions/index.ts";
import { recordAudit, extractRequestContext } from "../_shared/audit/index.ts";
import { emit } from "../_shared/events/index.ts";
import { idempotencyKeyHeaderSchema } from "../_shared/validation/schemas.ts";

const requestBodySchema = z.object({
  message: z.string().min(1).max(500),
});

async function handler(ctx: EdgeContext): Promise<Response> {
  // 1. Authorization — this template requires an active player; a real
  //    money-moving function would use requireVerifiedPlayer, a dispute
  //    decision function would use requireModerator, etc.
  requirePlayer(ctx.profile!);

  // 2. Idempotency — required for this template since it's illustrating the
  //    financial/webhook pattern; a pure read-only GET function would skip
  //    this entirely.
  const idempotencyKeyRaw = ctx.request.headers.get("Idempotency-Key");
  const idempotencyKey = idempotencyKeyHeaderSchema.parse(idempotencyKeyRaw);

  const rawBody = await parseJsonBody(ctx.request);
  const body = validateBody(requestBodySchema, rawBody);

  const idempotency = await beginIdempotentRequest<{ echoed: string }>(
    idempotencyKey,
    "_template",
    body,
  );

  if (idempotency.kind === "replayed") {
    return successResponse(idempotency.response.body, { status: idempotency.response.statusCode });
  }

  try {
    // 3. Transaction — real functions with multiple related writes should
    //    wrap them here. This template has nothing to actually persist, so
    //    it demonstrates the shape with a trivial no-op query.
    const result = await withTransaction(async (sql) => {
      await sql`select 1`;
      return { echoed: body.message };
    });

    // 4. Audit — every meaningful action should be recorded.
    const { ipAddress } = extractRequestContext(ctx.request);
    await recordAudit({
      actorId: ctx.user!.id,
      actorType: "user",
      action: "TemplateEchoed",
      category: "system",
      targetTable: "_template",
      targetId: ctx.user!.id,
      after: result,
      ipAddress,
    });

    // 5. Event — durably recorded, not an in-memory pub/sub (see
    //    _shared/events/index.ts's header comment for why).
    await emit({
      type: "NotificationQueued",
      payload: { reason: "template_echo", userId: ctx.user!.id },
      correlationId: ctx.correlationId,
      emittedBy: "_template",
    });

    await completeIdempotentRequest(idempotencyKey, 200, result);

    // 6. Standard response.
    return successResponse(result);
  } catch (err) {
    await failIdempotentRequest(idempotencyKey);
    throw err;
  }
}

Deno.serve(
  withEdgeFunction(
    {
      functionName: "_template",
      auth: "required",
      rateLimit: (ctx) => ({ key: `_template:${ctx.user?.id}`, windowSeconds: 60, maxRequests: 30 }),
    },
    handler,
  ),
);

// Re-exported so validation.test.ts-style Deno tests can exercise the
// schema without spinning up a server — see _template/index.test.ts.
export { requestBodySchema };
export const _forTesting = { ValidationError };
