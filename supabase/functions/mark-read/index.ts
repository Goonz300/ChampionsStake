// supabase/functions/mark-read/index.ts
// Handles both chat read receipts (markSeen) and notification read status
// (markNotificationRead/markAllNotificationsRead) behind one endpoint,
// distinguished by `target`.

import { z } from "npm:zod@3.24.1";
import { withEdgeFunction, type EdgeContext } from "../_shared/middleware/index.ts";
import { requirePlayer } from "../_shared/permissions/index.ts";
import { validateBody, parseJsonBody } from "../_shared/validation/validate.ts";
import { successResponse } from "../_shared/response/index.ts";
import { markSeen } from "../_realtime/chat.ts";
import { markNotificationRead, markAllNotificationsRead } from "../_realtime/notifications.ts";

const bodySchema = z.discriminatedUnion("target", [
  z.object({ target: z.literal("chat"), challengeId: z.string().uuid(), upToMessageId: z.string().uuid() }),
  z.object({ target: z.literal("notification"), notificationId: z.string().uuid() }),
  z.object({ target: z.literal("all_notifications") }),
]);

async function handler(ctx: EdgeContext): Promise<Response> {
  requirePlayer(ctx.profile!);
  const body = validateBody(bodySchema, await parseJsonBody(ctx.request));

  if (body.target === "chat") {
    await markSeen(body.challengeId, ctx.user!.id, body.upToMessageId);
  } else if (body.target === "notification") {
    await markNotificationRead(body.notificationId, ctx.user!.id);
  } else {
    await markAllNotificationsRead(ctx.user!.id);
  }

  return successResponse({ marked: true });
}

Deno.serve(withEdgeFunction({ functionName: "mark-read", auth: "required" }, handler));
