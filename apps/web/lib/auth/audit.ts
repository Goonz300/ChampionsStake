import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * Shared wrapper around the existing fn_write_audit_log RPC (0011), the
 * same entry point rate-limit.ts's recordFailedLogin and device.ts's
 * recordDevice already call inline. Extracted here because Phase 3C adds
 * several more call sites (MFA enable/disable, recovery code
 * generation/regeneration/use) -- duplicating the same five-argument RPC
 * shape a fifth and sixth time would be exactly the kind of copy-pasted
 * logic this codebase avoids elsewhere.
 */
export async function logSecurityEvent(
  actorId: string,
  action: string,
  targetTable: string,
  targetId: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const supabase = createServiceRoleClient();

  await supabase.rpc("fn_write_audit_log", {
    p_actor_id: actorId,
    p_actor_type: "user",
    p_action: action,
    p_category: "auth",
    p_target_table: targetTable,
    p_target_id: targetId,
    p_metadata: metadata,
  });
}
