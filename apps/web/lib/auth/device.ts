import { createHash } from "node:crypto";
import { createServiceRoleClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/**
 * Derives a stable device fingerprint from request headers. This is a
 * pragmatic v1 fingerprint (user-agent + accept-language + a truncated IP),
 * not a full browser-fingerprinting solution — sufficient to support the
 * multi-account/fraud-detection signal in Business Rules §14 without
 * introducing a third-party fingerprinting script.
 */
export function deriveDeviceFingerprint(
  userAgent: string,
  acceptLanguage: string,
  ipAddress: string,
): string {
  const ipPrefix = ipAddress.split(".").slice(0, 3).join("."); // /24-ish granularity, not exact IP
  return createHash("sha256").update(`${userAgent}|${acceptLanguage}|${ipPrefix}`).digest("hex");
}

export interface RecordDeviceResult {
  /** Null only if the insert itself failed -- logged, never thrown. */
  deviceId: string | null;
  isNewDevice: boolean;
}

/**
 * Upserts a device record for the user. Runs as service_role because
 * `devices` has no client INSERT policy (DB-002: "fingerprints are recorded
 * server-side at login"). Returns the row's id (to link
 * user_sessions.device_id, migration 0072) and whether this fingerprint was
 * genuinely new for this user.
 *
 * A first-seen fingerprint is logged as NewDeviceLogin via the existing
 * audit_logs path (Phase 3 Architecture Rev. 2, §8) -- deliberately not a
 * fraud_flags entry: a new device alone isn't inherently suspicious (most
 * are just someone's new phone) and would flood the moderator review queue
 * with noise. The logging call is fire-and-isolate -- a failure here must
 * never fail the login itself.
 */
export async function recordDevice(
  userId: string,
  fingerprint: string,
  platform: string | null,
  userAgent: string | null,
): Promise<RecordDeviceResult> {
  const supabase = createServiceRoleClient();

  const { data: existing } = await supabase
    .from("devices")
    .select("id")
    .eq("user_id", userId)
    .eq("device_fingerprint", fingerprint)
    .maybeSingle();

  if (existing) {
    await supabase
      .from("devices")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", existing.id);
    return { deviceId: existing.id, isNewDevice: false };
  }

  const { data: inserted, error: insertError } = await supabase
    .from("devices")
    .insert({ user_id: userId, device_fingerprint: fingerprint, platform, user_agent: userAgent })
    .select("id")
    .single();

  if (insertError || !inserted) {
    console.error("Failed to record new device:", insertError);
    return { deviceId: null, isNewDevice: true };
  }

  try {
    await supabase.rpc("fn_write_audit_log", {
      p_actor_id: userId,
      p_actor_type: "user",
      p_action: "NewDeviceLogin",
      p_category: "auth",
      p_target_table: "devices",
      p_target_id: inserted.id,
      p_metadata: {},
    });
  } catch (err) {
    console.error("Failed to log NewDeviceLogin (non-fatal):", err);
  }

  return { deviceId: inserted.id, isNewDevice: true };
}

export interface DeviceListItem {
  id: string;
  device_fingerprint: string;
  platform: string | null;
  user_agent: string | null;
  first_seen_at: string;
  last_seen_at: string;
}

/**
 * Lists the caller's own devices, most-recently-active first. Takes the
 * caller's own RLS-respecting client, not service-role -- 0018's
 * devices_select_self_or_staff policy already scopes this to the caller's
 * own rows at the database layer, which is a requirement here, not a
 * preference (Phase 3 Architecture Rev. 2, §11): a forgotten filter still
 * can't leak another user's devices.
 */
export async function listDevicesForUser(
  supabase: SupabaseClient<Database>,
): Promise<{ data: DeviceListItem[]; error: Error | null }> {
  const { data, error } = await supabase
    .from("devices")
    .select("id, device_fingerprint, platform, user_agent, first_seen_at, last_seen_at")
    .order("last_seen_at", { ascending: false });

  return { data: data ?? [], error };
}
