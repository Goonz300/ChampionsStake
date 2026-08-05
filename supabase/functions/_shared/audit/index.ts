// supabase/functions/_shared/audit/index.ts
//
// Thin wrapper around the existing `fn_write_audit_log` Postgres function
// (DB-002 migration 0016) — deliberately NOT a new audit table or a
// reimplementation, since audit_logs is already the single canonical audit
// trail every prior phase writes to. This module's job is just to make it
// easy for any future Edge Function to record a *complete* audit entry
// (who/when/action/before/after/IP/device/metadata) without every handler
// re-deriving how to shape that payload.

import { getServiceRoleClient } from "../database/client.ts";
import { logger } from "../logger/index.ts";

export type ActorType = "user" | "moderator" | "administrator" | "system";
export type AuditCategory =
  | "auth"
  | "financial"
  | "challenge"
  | "tournament"
  | "dispute"
  | "moderation"
  | "admin"
  | "system";

export interface AuditEntryInput {
  actorId: string | null;
  actorType: ActorType;
  action: string;
  category: AuditCategory;
  targetTable: string;
  targetId: string;
  before?: unknown;
  after?: unknown;
  ipAddress?: string | null;
  deviceFingerprint?: string | null;
  metadata?: Record<string, unknown>;
}

export async function recordAudit(entry: AuditEntryInput): Promise<void> {
  const supabase = getServiceRoleClient();

  const metadata = {
    ...(entry.before !== undefined ? { before: entry.before } : {}),
    ...(entry.after !== undefined ? { after: entry.after } : {}),
    ...(entry.ipAddress ? { ip_address: entry.ipAddress } : {}),
    ...(entry.deviceFingerprint
      ? { device_fingerprint: entry.deviceFingerprint }
      : {}),
    ...(entry.metadata ?? {}),
  };

  const { error } = await supabase.rpc("fn_write_audit_log", {
    p_actor_id: entry.actorId,
    p_actor_type: entry.actorType,
    p_action: entry.action,
    p_category: entry.category,
    p_target_table: entry.targetTable,
    p_target_id: entry.targetId,
    p_metadata: metadata,
  });

  if (error) {
    // An audit-write failure should never take down the actual request it's
    // describing — log loudly (so it's visible in monitoring) and continue.
    // The alternative (throwing) would mean a broken audit log could block
    // real user actions, which is the wrong tradeoff for a logging concern.
    logger.error("Failed to write audit log entry", {
      error: error.message,
      action: entry.action,
    });
  }
}

/** Convenience helper for extracting IP/device info from a request, so
 * callers don't have to know the header names. */
export function extractRequestContext(
  request: Request,
): { ipAddress: string | null; userAgent: string | null } {
  const ipAddress =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip") ??
      null;
  const userAgent = request.headers.get("user-agent");
  return { ipAddress, userAgent };
}
