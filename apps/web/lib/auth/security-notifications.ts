import { createServiceRoleClient } from "@/lib/supabase/server";

export type SecurityNotificationType =
  | "MfaEnabled"
  | "MfaDisabled"
  | "RecoveryCodesRegenerated"
  | "RecoveryCodeUsed"
  | "NewLogin"
  | "DeviceChange";

/**
 * Writes a security-category in-app notification. Phase 2 also shipped
 * push_tokens/email_queue/notification_templates, but those have no
 * sender/consumer built yet (confirmed by this phase's own audit) -- using
 * them would not actually notify anyone. The existing `notifications`
 * table (DB-001, category enum already includes 'security' since 0052) is
 * what the app's real, active in-app notification feed reads, so that's
 * what "reuse existing notification infrastructure" means in practice
 * here, not the still-inert queue tables.
 *
 * Fire-and-isolate, matching device.ts's NewDeviceLogin precedent: a
 * notification failing to write must never fail the security-relevant
 * action (MFA enable/disable, recovery code use, etc.) it's describing.
 */
export async function notifySecurityEvent(
  userId: string,
  type: SecurityNotificationType,
  payload: Record<string, unknown> = {},
): Promise<void> {
  try {
    const supabase = createServiceRoleClient();
    const { error } = await supabase.from("notifications").insert({
      user_id: userId,
      type,
      category: "security",
      payload,
    });
    if (error) {
      console.error(`Failed to write security notification (${type}), non-fatal:`, error);
    }
  } catch (err) {
    console.error(`Failed to write security notification (${type}), non-fatal:`, err);
  }
}
